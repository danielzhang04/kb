"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class Classes {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(id, owner) {
    this.id = id;
    this.owner = owner;
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.dataset = {};
    this.classList = new Classes();
    this.listeners = {};
    this._innerHTML = "";
  }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatch(type) {
    for (const callback of this.listeners[type] || []) callback({target: this, preventDefault() {}});
  }
  setAttribute() {}
  focus() {}
  reset() {}
  closest() { return this; }
  set innerHTML(value) {
    this._innerHTML = value;
    if (this.id === "draftDetail") this.owner.hydrateDraft(value);
  }
  get innerHTML() { return this._innerHTML; }
}

class Document {
  constructor(html) {
    this.elements = new Map();
    this.listeners = {};
    this.body = new Element("body", this);
    for (const match of html.matchAll(/id="([^"]+)"/g)) this.getElementById(match[1]);
    for (const id of ["draftSubject", "draftBody", "feedbackDisposition", "feedbackText", "localDraftNotice", "draftError"])
      this.getElementById(id);
  }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new Element(id, this));
    return this.elements.get(id);
  }
  querySelector(selector) {
    if (selector === 'meta[name="csrf-token"]') return {content: "csrf-test"};
    return null;
  }
  querySelectorAll() { return []; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  emit(type, target) {
    for (const callback of this.listeners[type] || []) callback({target, preventDefault() {}});
  }
  hydrateDraft(html) {
    const decode = value => String(value || "").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
    const subject = html.match(/id="draftSubject" value="([^"]*)"/);
    const body = html.match(/<textarea id="draftBody"[^>]*>([\s\S]*?)<\/textarea>/);
    const feedback = html.match(/<textarea id="feedbackText"[^>]*>([\s\S]*?)<\/textarea>/);
    if (subject) this.getElementById("draftSubject").value = decode(subject[1]);
    if (body) this.getElementById("draftBody").value = decode(body[1]);
    if (feedback) this.getElementById("feedbackText").value = decode(feedback[1]);
    this.getElementById("feedbackDisposition").value = "tone";
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve));

function snapshot(campaign, subject = "Server subject", body = "Server body") {
  const campaigns = ["A", "B"].map(id => ({campaign_id: id, intent: `campaign_${id}`, status: "draft", next_action: "review_drafts"}));
  return {
    campaigns, sender_profiles: [], mailboxes: [], campaign: campaign ? campaigns.find(item => item.campaign_id === campaign) : null,
    people: [], schedule: [], activity: [], control: null, pipeline: null, funding: null,
    editorial_pipeline: [], next_action: {},
    drafts: campaign ? [{campaign_id: campaign, person_id: `person-${campaign}`, full_name: `Person ${campaign}`, revision_id: `rev-${campaign}`,
      step: 0, subject, body, evidence: [], candidate_id: null, candidate_subject: null, candidate_body: null,
      candidate_state: null, qa_failure_codes: [], candidate_history: [], editorial_state: "review_required",
      approval_state: "missing", feedback_state: null}] : [],
  };
}

function harness() {
  const htmlPath = path.join(__dirname, "..", "review_app.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const source = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
  const document = new Document(html);
  const requests = [];
  let uuid = 0;
  const context = vm.createContext({
    console, document, encodeURIComponent, setTimeout, clearTimeout,
    crypto: {randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${(++uuid).toString(16).padStart(12, "a")}`},
    fetch(url, init = {}) {
      return new Promise((resolve, reject) => requests.push({url, init, resolve, reject}));
    },
  });
  const defaults = {
    purpose: "networking", targetCount: "20", tone: "warm", conversationAsk: "informational_call", minutes: "15",
    industry: "", role: "", location: "", advancedBrief: "", priorCareer: "", mustHave: "", preferred: "",
    modelVersion: "", senderProfile: "profile", mailboxId: "mailbox",
  };
  for (const [id, value] of Object.entries(defaults)) document.getElementById(id).value = value;
  vm.runInContext(source, context, {filename: htmlPath});
  return {
    context, document, requests,
    reply(request, value, ok = true) { request.resolve({ok, async json() { return value; }}); },
    evaluate(source) { return vm.runInContext(source, context); },
  };
}

test("latest campaign load wins and accepted failure clears prior projections", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();

  app.evaluate('state.campaign="A"; globalThis.loadA=load("A")');
  const loadA = app.requests.shift();
  app.evaluate('state.campaign="B"; globalThis.loadB=load("B")');
  const loadB = app.requests.shift();
  const current = snapshot("B");
  current.funding = {
    state: "awaiting_qualification_factcheck", candidate_count: 1,
    provisional_match_count: 0, provisional_excluded_count: 0, unknown_count: 1,
    collision_count: 0, provisional_shortfall: 1,
    companies: [{name: "Current B Funding", provisional_state: "unknown",
      reason_codes: ["current_coverage_missing"], latest_stage: null,
      latest_announced_at: null, sources: []}],
  };
  app.reply(loadB, current);
  await app.context.loadB;
  const obsolete = snapshot("A");
  obsolete.funding = {
    state: "awaiting_qualification_factcheck", candidate_count: 1,
    provisional_match_count: 1, provisional_excluded_count: 0, unknown_count: 0,
    collision_count: 0, provisional_shortfall: 0,
    companies: [{name: "Obsolete A Funding", provisional_state: "provisional_match",
      reason_codes: [], latest_stage: "series_a", latest_announced_at: "2025-01-01",
      sources: []}],
  };
  app.reply(loadA, obsolete);
  await app.context.loadA;
  assert.equal(app.evaluate("state.campaign"), "B");
  assert.equal(app.evaluate("state.data.campaign.campaign_id"), "B");
  assert.equal(app.document.getElementById("draftSubject").value, "Server subject");
  assert.match(app.document.getElementById("campaignDetail").innerHTML, /Current B Funding/);
  assert.doesNotMatch(app.document.getElementById("campaignDetail").innerHTML, /Obsolete A Funding/);

  app.evaluate('state.campaign="A"; globalThis.failed=load("A")');
  const failed = app.requests.shift();
  assert.equal(app.evaluate("state.data.drafts.length"), 0, "old B projections clear while A loads");
  app.reply(failed, {error: "campaign_missing"}, false);
  await app.context.failed;
  assert.equal(app.evaluate("state.campaign"), "A");
  assert.equal(app.evaluate("state.data.drafts.length"), 0);
  assert.equal(app.document.getElementById("nextTitle").textContent, "Review data unavailable");
  assert.equal(app.document.body.classList.contains("loading"), false);
});

test("newer draft and feedback typing survives an older save and reload", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  app.evaluate('state.campaign="A"; globalThis.loaded=load("A")');
  app.reply(app.requests.shift(), snapshot("A"));
  await app.context.loaded;

  const subject = app.document.getElementById("draftSubject");
  const body = app.document.getElementById("draftBody");
  const feedback = app.document.getElementById("feedbackText");
  subject.value = "Submitted subject"; app.document.emit("input", subject);
  body.value = "Submitted body"; app.document.emit("input", body);
  feedback.value = "Keep this note"; app.document.emit("input", feedback);
  app.document.emit("click", {closest: () => ({dataset: {edit: "rev-A"}})});
  const save = app.requests.shift();

  subject.value = "Newer unsaved subject"; app.document.emit("input", subject);
  body.value = "Newer unsaved body"; app.document.emit("input", body);
  feedback.value = "Newer unsaved feedback"; app.document.emit("input", feedback);
  app.reply(save, {revision_id: "rev-A", state: "pending_qa"});
  await tick(); await tick();
  const reload = app.requests.shift();
  assert.ok(reload.url.includes("campaign_id=A"));
  app.reply(reload, snapshot("A", "Submitted subject", "Submitted body"));
  await tick(); await tick();

  assert.equal(subject.value, "Newer unsaved subject");
  assert.equal(body.value, "Newer unsaved body");
  assert.equal(feedback.value, "Newer unsaved feedback");
  assert.equal(app.evaluate('state.editors[editorKey("A","rev-A")].dirty'), true);

  app.evaluate('state.campaign="B"; globalThis.toB=load("B")');
  app.reply(app.requests.shift(), snapshot("B"));
  await app.context.toB;
  app.evaluate('state.campaign="A"; globalThis.backA=load("A")');
  app.reply(app.requests.shift(), snapshot("A", "Submitted subject", "Submitted body"));
  await app.context.backA;
  assert.equal(subject.value, "Newer unsaved subject");
  assert.equal(feedback.value, "Newer unsaved feedback");
});

test("background completion does not change selection and request IDs follow payload", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  app.evaluate('state.campaign="B"; state.data=' + JSON.stringify(snapshot("B")));
  app.evaluate('globalThis.preparing=prepareDrafts("A")');
  const prepare = app.requests.shift();
  app.reply(prepare, {campaign_id: "A", step: 0, candidates: 1, revisions_created: 1, out_of_band: 0, qa_failed: 0, slots_clamped: 0, failure_codes: []});
  await app.context.preparing;
  assert.equal(app.evaluate("state.campaign"), "B");
  assert.equal(app.requests.length, 0, "prepare completion did not refresh A");

  app.evaluate('globalThis.mutating=mutate("ready:rev-A","/api/drafts/ready",{campaign_id:"A",expected_revision_id:"rev-A",ready:true},"draftError")');
  const mutation = app.requests.shift();
  app.reply(mutation, {revision_id: "rev-A", state: "ready"});
  await app.context.mutating;
  assert.equal(app.evaluate("state.campaign"), "B");
  assert.equal(app.requests.length, 0, "mutation completion did not refresh A");

  const ids = app.evaluate(`(() => {
    const one={brief_text:"same",sender_profile_id:"p",mailbox_id:"m"}; campaignRequest(one);
    const two={brief_text:"same",sender_profile_id:"p",mailbox_id:"m"}; campaignRequest(two);
    const three={brief_text:"changed",sender_profile_id:"p",mailbox_id:"m"}; campaignRequest(three);
    const first=mutationRequest("edit:r",{subject:"same"});
    const retry=mutationRequest("edit:r",{subject:"same"});
    const changed=mutationRequest("edit:r",{subject:"changed"});
    return [one.request_id,two.request_id,three.request_id,first.id,retry.id,changed.id];
  })()`);
  assert.equal(ids[0], ids[1], "unchanged campaign retry retains its request ID");
  assert.notEqual(ids[1], ids[2], "changed campaign payload gets a new request ID");
  assert.equal(ids[3], ids[4], "unchanged mutation retry retains its request ID");
  assert.notEqual(ids[4], ids[5], "changed mutation payload gets a new request ID");

  const blocked = app.evaluate('prepareSummary({campaign_id:"B",candidates:2,revisions_created:0,out_of_band:1,qa_failed:1,slots_clamped:0,failure_codes:[["affinity_below_minimum",1]]},"B")');
  assert.match(blocked, /No drafts were prepared; 2 saved selections were blocked/);
  assert.doesNotMatch(blocked, /No additional drafts were needed/);
  assert.match(blocked, /fit below approved minimum/);
});

test("obsolete campaign-create success and error cannot replace newer UI context", async () => {
  const afterNew = harness();
  afterNew.reply(afterNew.requests.shift(), snapshot(null));
  await tick(); await tick();
  const originalId = afterNew.evaluate("state.campaignRequest.id");
  afterNew.document.getElementById("campaignForm").dispatch("submit");
  const oldSuccess = afterNew.requests.shift();
  assert.equal(JSON.parse(oldSuccess.init.body).request_id, originalId);
  afterNew.document.getElementById("newCampaign").dispatch("click");
  const replacementId = afterNew.evaluate("state.campaignRequest.id");
  assert.notEqual(replacementId, originalId, "New campaign creates a distinct retry identity");
  afterNew.reply(oldSuccess, {campaign_id: "A", created: true});
  await tick(); await tick();
  assert.equal(afterNew.evaluate("state.campaign"), "");
  assert.equal(afterNew.evaluate("state.campaignSaved"), false);
  assert.equal(afterNew.requests.length, 0, "obsolete success did not start an old-campaign load");

  const afterSwitch = harness();
  afterSwitch.reply(afterSwitch.requests.shift(), snapshot("A"));
  await tick(); await tick();
  afterSwitch.document.getElementById("newCampaign").dispatch("click");
  afterSwitch.document.getElementById("campaignForm").dispatch("submit");
  const oldError = afterSwitch.requests.shift();
  const retryId = JSON.parse(oldError.init.body).request_id;
  const picker = afterSwitch.document.getElementById("campaignSelect");
  picker.value = "B";
  picker.dispatch("change");
  const loadB = afterSwitch.requests.shift();
  afterSwitch.reply(loadB, snapshot("B"));
  await tick(); await tick();
  afterSwitch.reply(oldError, {error: "sender_profile_missing"}, false);
  await tick(); await tick();
  assert.equal(afterSwitch.evaluate("state.campaign"), "B");
  assert.equal(afterSwitch.document.getElementById("campaignError").textContent, "");
  assert.equal(afterSwitch.document.getElementById("campaignError").classList.contains("show"), false);
  assert.equal(afterSwitch.evaluate("state.campaignRequest.id"), retryId, "navigation does not alter unchanged retry identity");
  assert.equal(afterSwitch.requests.length, 0);
});

test("New campaign and a blank picker synchronously clear campaign projections", async () => {
  const afterNew = harness();
  afterNew.reply(afterNew.requests.shift(), snapshot("A"));
  await tick(); await tick();
  const subject = afterNew.document.getElementById("draftSubject");
  subject.value = "Unsaved A subject";
  afterNew.document.emit("input", subject);
  afterNew.document.getElementById("newCampaign").dispatch("click");
  assert.equal(afterNew.evaluate('[state.data.people.length,state.data.drafts.length,state.data.schedule.length,state.data.activity.length].join(",")'), "0,0,0,0");
  assert.equal(afterNew.evaluate("state.campaign"), "");
  assert.match(afterNew.document.getElementById("peopleList").innerHTML, /No matching people/);
  assert.match(afterNew.document.getElementById("draftList").innerHTML, /No drafts yet/);
  assert.match(afterNew.document.getElementById("scheduleList").innerHTML, /No messages are scheduled/);
  assert.match(afterNew.document.getElementById("activityList").innerHTML, /No campaign activity/);
  assert.equal(afterNew.evaluate('state.editors[editorKey("A","rev-A")].subject'), "Unsaved A subject");
  assert.equal(afterNew.document.getElementById("campaignCreateFields").hidden, false);
  assert.equal(afterNew.document.getElementById("saveCampaign").hidden, false);
  assert.equal(afterNew.document.getElementById("campaignDetailCard").hidden, true);
  assert.equal(afterNew.document.getElementById("campaignEditorTitle").textContent, "Create a campaign");

  const afterBlank = harness();
  afterBlank.reply(afterBlank.requests.shift(), snapshot("A"));
  await tick(); await tick();
  const picker = afterBlank.document.getElementById("campaignSelect");
  picker.value = "";
  picker.dispatch("change");
  const pending = afterBlank.requests.shift();
  assert.equal(pending.url, "/api/review");
  assert.equal(afterBlank.evaluate('[state.data.people.length,state.data.drafts.length,state.data.schedule.length,state.data.activity.length].join(",")'), "0,0,0,0");
  assert.equal(afterBlank.evaluate("state.campaign"), "");
  assert.equal(afterBlank.document.getElementById("campaignCreateFields").hidden, false);
  assert.equal(afterBlank.document.getElementById("campaignDetailCard").hidden, true);
  assert.match(afterBlank.document.getElementById("draftList").innerHTML, /No drafts yet/);
  afterBlank.reply(pending, snapshot(null));
  await tick(); await tick();
});

test("selected campaign puts saved evidence first and keeps only research editing visible", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const selected = snapshot("A");
  selected.pipeline = {
    state: "awaiting_research_adapter", campaign_id: "A", requested_companies: 8,
    requested_people_per_company: 2, funding_window_years: 3,
    next_stage: "research_adapter", intake_revision: 1, run_id: "run-A",
  };
  selected.funding = {
    state: "awaiting_qualification_factcheck", batch_id: "batch_aaaaaaaaaaaaaaaa",
    candidate_count: 1, provisional_match_count: 0, provisional_excluded_count: 0,
    unknown_count: 1, collision_count: 0, provisional_shortfall: 8,
    companies: [{name: "Saved Research Company", provisional_state: "unknown",
      reason_codes: ["current_coverage_missing"], latest_stage: null,
      latest_announced_at: null, sources: []}],
  };
  app.evaluate('state.campaign="A"; globalThis.selectedLoad=load("A")');
  app.reply(app.requests.shift(), selected);
  await app.context.selectedLoad;

  assert.equal(app.document.getElementById("campaignCreateFields").hidden, true);
  assert.equal(app.document.getElementById("saveCampaign").hidden, true);
  assert.equal(app.document.getElementById("campaignDetailCard").hidden, false);
  assert.equal(app.document.getElementById("campaignEditorTitle").textContent, "Edit research brief");
  assert.equal(app.document.getElementById("researchBriefSummary").textContent, "Edit research brief");
  assert.equal(app.document.getElementById("saveResearchBrief").hidden, false);
  assert.match(app.document.getElementById("campaignDetail").innerHTML, /Saved Research Company/);

  app.document.getElementById("campaignForm").dispatch("submit");
  assert.equal(app.requests.length, 0, "selected-campaign form cannot create another campaign");
});

test("campaign workspace cards are full width with saved detail ordered before the editor", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "review_app.html"), "utf8");
  assert.match(html, /id="campaignEditorCard"[^>]*class="card full campaign-editor"|class="card full campaign-editor"[^>]*id="campaignEditorCard"/);
  assert.match(html, /id="campaignDetailCard"[^>]*class="card full campaign-detail"|class="card full campaign-detail"[^>]*id="campaignDetailCard"/);
  assert.match(html, /\.campaign-detail\{order:1\}\.campaign-editor\{order:2\}/);
  assert.match(html, /#campaignCreateFields\[hidden\]\{display:none\}/);
});

test("feedback remains visible on its child and fulfillment uses the projected revision", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const value = snapshot("A");
  value.feedback = [{
    feedback_id: "feedback-A", campaign_id: "A", person_id: "person-A",
    original_revision_id: "rev-original-A", original_subject: "Original <subject>",
    original_body: "Original body", disposition: "tone", tags: ["warmer"],
    feedback_text: "Use a warmer opening.", requested_at: "2026-09-09T04:00:00Z",
    state: "ready_to_record", automated_rewrite_state: "unavailable",
    eligible_revision_id: "rev-A", eligible_subject: "Server subject",
    eligible_body: "Server body", fulfilled_at: null,
  }];
  app.evaluate('state.campaign="A"; globalThis.feedbackLoad=load("A")');
  app.reply(app.requests.shift(), value);
  await app.context.feedbackLoad;
  const detail = app.document.getElementById("draftDetail").innerHTML;
  assert.match(detail, /No automated rewrite is running/);
  assert.match(detail, /Use a warmer opening/);
  assert.match(detail, /Original &lt;subject&gt;/);
  assert.match(detail, /Record correction fulfilled/);

  app.document.emit("click", {closest: () => ({dataset: {
    fulfillFeedback: "feedback-A", feedbackChild: "rev-A",
  }})});
  const fulfill = app.requests.shift();
  assert.equal(fulfill.url, "/api/feedback/fulfill");
  const payload = JSON.parse(fulfill.init.body);
  assert.equal(payload.campaign_id, "A");
  assert.equal(payload.feedback_id, "feedback-A");
  assert.equal(payload.expected_child_revision_id, "rev-A");
  assert.match(payload.request_id, /^[0-9a-f-]{36}$/);
  app.reply(fulfill, {state: "fulfilled", child_revision_id: "rev-A"});
  await tick(); await tick();
  const reload = app.requests.shift();
  value.feedback[0].state = "fulfilled";
  value.feedback[0].fulfilled_at = "2026-09-09T05:00:00Z";
  app.reply(reload, value);
  await tick(); await tick();
  assert.match(app.document.getElementById("draftDetail").innerHTML, /Correction recorded/);
});

test("saved source upload sends only the selected URL and local bytes before confirmation", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const value = snapshot("A");
  value.people = [{
    person_id: "person-A", full_name: "Person A", title: "Principal", company: "Example A",
    linkedin_url: "https://profile.example.test/a", selected: true, state: "selected",
    identity_source_state: "source_missing", identity_sources: [], current_observation_id: "obs-prior",
  }];
  app.evaluate('state.campaign="A"; globalThis.sourceLoad=load("A")');
  app.reply(app.requests.shift(), value);
  await app.context.sourceLoad;
  const sourceUrl = app.document.getElementById("sourceUrl");
  const sourceFile = app.document.getElementById("sourceFile");
  sourceUrl.value = "https://profile.example.test/saved";
  sourceFile.files = [{size: 37, name: "private-local-file.html", async text() {
    return "Person A is Principal at Example A";
  }}];
  app.document.emit("click", {closest: () => ({dataset: {importSource: "person-A"}})});
  await tick(); await tick();
  const upload = app.requests.shift();
  assert.equal(upload.url, "/api/people/import-source");
  const payload = JSON.parse(upload.init.body);
  assert.deepEqual(Object.keys(payload).sort(), ["body", "campaign_id", "person_id", "source_url"]);
  assert.equal(payload.body, "Person A is Principal at Example A");
  assert.equal(JSON.stringify(payload).includes("private-local-file.html"), false);
  app.reply(upload, {campaign_id: "A", person_id: "person-A", snapshot_id: "snapshot-A", state: "source_available"});
  await tick(); await tick();
  const reload = app.requests.shift();
  value.people[0].identity_source_state = "confirmation_required";
  value.people[0].identity_sources = [{observation_id: "source-A", excerpt: payload.body,
    source_url: payload.source_url, retrieved_at: "2026-09-09T04:00:00Z"}];
  app.reply(reload, value);
  await tick(); await tick();
  const detail = app.document.getElementById("personDetail").innerHTML;
  assert.match(detail, /Confirm current role source/);
  assert.match(detail, /I confirm this source shows Person A/);
});

test("draft card keeps exact source confirmation and missing contact beside the email", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const value = snapshot("A");
  Object.assign(value.drafts[0], {
    identity_source_state: "confirmation_required",
    identity_source: {
      observation_id: "source-A", snapshot_id: "snapshot-A",
      source_url: "https://profile.example.test/source",
      excerpt: "Person A is <Lead> at Example A", retrieved_at: "2026-09-09T04:00:00Z",
      expires_at: "2099-01-01T00:00:00Z", is_current: false,
    },
    current_observation_id: "source-prior-A", contact_state: "missing",
    source_error_code: null,
  });
  app.evaluate('state.campaign="A"; globalThis.sourceDraftLoad=load("A")');
  app.reply(app.requests.shift(), value);
  await app.context.sourceDraftLoad;
  const detail = app.document.getElementById("draftDetail").innerHTML;
  assert.match(detail, /Source confirmation needed/);
  assert.match(detail, /Person A is &lt;Lead&gt; at Example A/);
  assert.match(detail, /Open exact source/);
  assert.match(detail, /Contact address missing/);
  assert.match(detail, /cannot be approved, scheduled, or sent/);
  assert.doesNotMatch(detail, /Person A is <Lead>/);

  const button = {
    disabled: false,
    dataset: {
      verifySource: "source-A", personId: "person-A",
      expectedSource: "source-prior-A", sourceError: "draftError",
    },
    closest() { return this; },
  };
  app.document.emit("click", button);
  const mutation = app.requests.shift();
  assert.equal(mutation.url, "/api/people/verify-source");
  const payload = JSON.parse(mutation.init.body);
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["attested", "campaign_id", "expected_observation_id", "observation_id", "person_id", "request_id"],
  );
  assert.equal(payload.attested, true);
  assert.equal(payload.observation_id, "source-A");
  assert.equal(payload.expected_observation_id, "source-prior-A");
});

test("editorial stages and exact suggestion actions stay beside the source-bound email", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const waiting = snapshot("A");
  Object.assign(waiting.drafts[0], {
    editorial_gate_code: "editorial_receipts_missing",
    identity_source_state: "confirmation_required",
    identity_source: {
      observation_id: "source-A", source_url: "https://profile.example.test/source",
      excerpt: "Person A is Principal at Example A", is_current: false,
    },
    current_observation_id: "source-prior-A", contact_state: "missing",
  });
  waiting.editorial_pipeline = [{
    revision_id: "rev-A", item: {
      item_id: "item-A", campaign_id: "A", person_id: "person-A",
      base_revision_id: "rev-A", state: "awaiting_humanizer_adapter",
      next_stage: "humanizer", repair_cycle: 0,
    },
    source_proof: null, suggestion_id: null, suggestion_subject: null,
    suggestion_body: null, proposed_revision_hash: null, decision: null,
  }];
  app.evaluate('state.campaign="A"; globalThis.editorialLoad=load("A")');
  app.reply(app.requests.shift(), waiting);
  await app.context.editorialLoad;
  let detail = app.document.getElementById("draftDetail").innerHTML;
  assert.match(detail, /Canonical local email draft/);
  assert.match(detail, /Editorial review waiting/);
  assert.match(detail, /Waiting for humanizer/);
  assert.match(detail, /No provider activity is launched/);
  assert.match(detail, /Source confirmation needed/);
  assert.match(detail, /Contact address missing/);

  const suggestion = structuredClone(waiting);
  Object.assign(suggestion.editorial_pipeline[0], {
    suggestion_id: "suggestion-A", suggestion_subject: "A <better> subject",
    suggestion_body: "A careful & sourced body", proposed_revision_hash: "a".repeat(64),
  });
  Object.assign(suggestion.editorial_pipeline[0].item, {state: "human_review", next_stage: null});
  app.evaluate('globalThis.suggestionLoad=load("A")');
  app.reply(app.requests.shift(), suggestion);
  await app.context.suggestionLoad;
  detail = app.document.getElementById("draftDetail").innerHTML;
  assert.match(detail, /Agent suggestion/);
  assert.match(detail, /A &lt;better&gt; subject/);
  assert.match(detail, /A careful &amp; sourced body/);
  assert.doesNotMatch(detail, /A <better>/);

  app.document.emit("click", {closest: () => ({disabled: false, dataset: {
    editorialAccept: "item-A", editorialParent: "rev-A",
  }})});
  const accept = app.requests.shift();
  assert.equal(accept.url, "/api/editorial/accept");
  const payload = JSON.parse(accept.init.body);
  assert.deepEqual(Object.keys(payload).sort(), [
    "campaign_id", "expected_parent_revision_id", "item_id", "request_id",
  ]);
  assert.equal(payload.campaign_id, "A");
  assert.equal(payload.item_id, "item-A");
  assert.equal(payload.expected_parent_revision_id, "rev-A");
  app.reply(accept, {decision_id: "decision-A", revision_id: "rev-B",
    revision_hash: "b".repeat(64), unchanged: false, replayed: false});
  await tick(); await tick();
  const reload = app.requests.shift();
  app.reply(reload, suggestion);
  await tick(); await tick();

  app.document.emit("click", {closest: () => ({disabled: false, dataset: {
    editorialReject: "item-A", editorialParent: "rev-A",
  }})});
  const reject = app.requests.shift();
  assert.equal(reject.url, "/api/editorial/reject");
  const rejectPayload = JSON.parse(reject.init.body);
  assert.equal(rejectPayload.item_id, "item-A");
  assert.equal(rejectPayload.expected_parent_revision_id, "rev-A");
  assert.notEqual(rejectPayload.request_id, payload.request_id);
  app.reply(reject, {decision_id: "decision-B", item_id: "item-A", replayed: false});
  await tick(); await tick();
  app.reply(app.requests.shift(), suggestion);
  await tick(); await tick();
});

test("editorial start retry is payload-bound and Mark ready still requires human source confirmation", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const value = snapshot("A");
  Object.assign(value.drafts[0], {
    editorial_gate_code: "editorial_receipts_missing",
    identity_source_state: "confirmation_required", contact_state: "missing",
  });
  app.evaluate('state.campaign="A"; globalThis.startLoad=load("A")');
  app.reply(app.requests.shift(), value);
  await app.context.startLoad;
  let detail = app.document.getElementById("draftDetail").innerHTML;
  assert.match(detail, /Editorial review has not started/);
  assert.match(detail, /data-ready="rev-A" disabled/);

  app.document.emit("click", {closest: () => ({disabled: false, dataset: {
    editorialStart: "rev-A",
  }})});
  const start = app.requests.shift();
  assert.equal(start.url, "/api/editorial/start");
  const first = JSON.parse(start.init.body);
  assert.deepEqual(Object.keys(first).sort(), ["campaign_id", "request_id", "revision_id"]);
  app.reply(start, {item_id: "item-A", campaign_id: "A", person_id: "person-A",
    base_revision_id: "rev-A", state: "awaiting_humanizer_adapter", next_stage: "humanizer", repair_cycle: 0});
  await tick(); await tick();
  app.reply(app.requests.shift(), value);
  await tick(); await tick();

  value.drafts[0].editorial_gate_code = null;
  app.evaluate('globalThis.acceptedLoad=load("A")');
  app.reply(app.requests.shift(), value);
  await app.context.acceptedLoad;
  detail = app.document.getElementById("draftDetail").innerHTML;
  assert.match(detail, /Editorial checks complete/);
  assert.match(detail, /data-ready="rev-A" disabled/);

  value.drafts[0].identity_source_state = "source_ready";
  app.evaluate('globalThis.confirmedLoad=load("A")');
  app.reply(app.requests.shift(), value);
  await app.context.confirmedLoad;
  detail = app.document.getElementById("draftDetail").innerHTML;
  assert.match(detail, /data-ready="rev-A" >Mark ready/);
  assert.match(detail, /Contact address missing/);
  assert.match(detail, /cannot be approved, scheduled, or sent/);
  const ready = app.document.getElementById("draftReady");
  assert.equal(ready.disabled, false);
  const subject = app.document.getElementById("draftSubject");
  subject.value = "Unsaved visible subject";
  app.document.emit("input", subject);
  assert.equal(ready.disabled, true);
  app.document.emit("click", ready);
  assert.equal(app.requests.length, 0, "unsaved visible text cannot ready the stored revision");
});

test("history selection disables readiness and the click guard refuses unsaved text", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const value = snapshot("A");
  Object.assign(value.drafts[0], {
    editorial_gate_code: null, identity_source_state: "source_ready",
    contact_state: "valid", candidate_history: [{
      subject: "Earlier saved subject", body: "Earlier saved body",
      qa_state: "revision_created", is_current_parent: false,
    }],
  });
  app.evaluate('state.campaign="A"; globalThis.historyLoad=load("A")');
  app.reply(app.requests.shift(), value);
  await app.context.historyLoad;
  const ready = app.document.getElementById("draftReady");
  assert.equal(ready.disabled, false);

  app.document.emit("click", {closest: () => ({disabled: false, dataset: {
    historyIndex: "0",
  }})});
  assert.equal(app.document.getElementById("draftSubject").value, "Earlier saved subject");
  assert.equal(ready.disabled, true);
  assert.equal(app.requests.length, 0);

  ready.disabled = false;
  ready.dataset.ready = "rev-A";
  app.document.emit("click", ready);
  assert.equal(app.requests.length, 0, "defensive click guard blocks dirty stored revision");
  assert.match(app.document.getElementById("draftError").textContent, /Save and complete review/);
});

test("control action sends only the selected opaque request and reports acknowledgement", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const value = snapshot("A");
  value.control = {
    enabled: true, campaign_id: "A", configured_request_id: "ctlreq_fixture",
    control_ref: "ctl_fixture", operation: "status", grant_state: "active",
    receipt_state: null, remote_acknowledgement: "not_applicable", code: "ready", counts: {},
  };
  app.evaluate('state.campaign="A"; globalThis.controlLoad=load("A")');
  app.reply(app.requests.shift(), value);
  await app.context.controlLoad;
  assert.match(app.document.getElementById("controlPanel").innerHTML, /Check campaign status/);

  app.evaluate('globalThis.controlRun=processControl("ctlreq_fixture")');
  const process = app.requests.shift();
  assert.equal(process.url, "/api/control/process");
  assert.deepEqual(JSON.parse(process.init.body), {
    campaign_id: "A", configured_request_id: "ctlreq_fixture",
  });
  app.reply(process, {...value.control, receipt_state: "succeeded",
    remote_acknowledgement: "confirmed", code: "status", counts: {due: 2}});
  await app.context.controlRun;
  const panel = app.document.getElementById("controlPanel").innerHTML;
  assert.match(panel, /succeeded/);
  assert.match(panel, /due/);
  assert.doesNotMatch(panel, /Confirm result receipt/);
});

test("research brief retries keep the request identity and drafts stay campaign-scoped", () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  app.evaluate(`state.campaign="A"; Object.assign($("asOfDate"),{value:"2026-09-09"});
    Object.assign($("fundingStageMin"),{value:"series_a"}); Object.assign($("fundingStageMax"),{value:"series_c"});
    Object.assign($("fundingWindowYears"),{value:"3"}); Object.assign($("stageInterpretation"),{value:"latest_known"});
    Object.assign($("geoMode"),{value:"unknown"}); Object.assign($("sectorMode"),{value:"unknown"});
    Object.assign($("companyCount"),{value:"20"}); Object.assign($("peoplePerCompany"),{value:"2"});
    Object.assign($("roleFamilies"),{value:"operations"}); Object.assign($("outreachGoal"),{value:"A goal"}); captureResearchBrief();
    globalThis.firstSave=saveResearchBrief("A",state.researchDrafts.A.value)`);
  const first = app.requests.shift();
  assert.equal(first.url, "/api/pipeline/start");
  const firstPayload = JSON.parse(first.init.body);
  app.evaluate('globalThis.retrySave=saveResearchBrief("A",state.researchDrafts.A.value)');
  const retry = app.requests.shift();
  const retryPayload = JSON.parse(retry.init.body);
  assert.equal(retryPayload.request_id, firstPayload.request_id, "unchanged retry retains identity");
  app.evaluate('state.campaign="B"; hydrateResearchBrief(null); $("outreachGoal").value="B goal"; captureResearchBrief(); state.campaign="A"; hydrateResearchBrief(null)');
  assert.equal(app.document.getElementById("outreachGoal").value, "A goal");
  app.evaluate('state.campaign="B"; hydrateResearchBrief(null)');
  assert.equal(app.document.getElementById("outreachGoal").value, "B goal");
});


test("draft readiness stays disabled while required review stages are unavailable", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  app.evaluate('state.campaign="A"; globalThis.loaded=load("A")');
  const value = snapshot("A");
  value.drafts[0].editorial_gate_code = "editorial_receipts_missing";
  app.reply(app.requests.shift(), value);
  await app.context.loaded;
  const markup = app.document.getElementById("draftDetail").innerHTML;
  assert.match(markup, /data-ready="rev-A" disabled/);
  assert.match(markup, /Editorial review has not started/);
  assert.match(markup, /Run editorial review/);
  app.document.emit("click", {closest: () => ({disabled: true, dataset: {ready: "rev-A"}})});
  assert.equal(app.requests.length, 0);
  assert.equal(app.document.getElementById("draftBody").value, "Server body");
});

test("funding evidence renders escaped provisional details and recorded source types without mutations", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const value = snapshot("A");
  value.funding = {
    state: "awaiting_qualification_factcheck", batch_id: "batch_aaaaaaaaaaaaaaaa",
    candidate_count: 1, provisional_match_count: 1, provisional_excluded_count: 0,
    unknown_count: 0, collision_count: 0, provisional_shortfall: 1,
    companies: [{
      name: '<img src=x onerror="bad">', provisional_state: "provisional_match",
      reason_codes: ["latest_event_eligible_with_current_coverage"],
      latest_stage: "series_b", latest_announced_at: "2025-05-01",
      sources: [
        {source_url: "https://source.invalid/item?a=1&b=2", source_kind: '<issuer & "claimed">', binding_kind: "funding_event", retrieved_at: "2026-09-10T12:00:00Z"},
        {source_url: "javascript:bad()", source_kind: "issuer", binding_kind: "funding_event", retrieved_at: "2026-09-10T12:00:00Z"},
      ],
    }],
  };
  app.evaluate('state.campaign="A"; globalThis.fundingLoad=load("A")');
  app.reply(app.requests.shift(), value);
  await app.context.fundingLoad;

  const markup = app.document.getElementById("campaignDetail").innerHTML;
  assert.match(markup, /Funding evidence &middot; provisional/);
  assert.match(markup, /Awaiting funding factcheck/);
  assert.match(markup, /Provisional match - factual review pending/);
  assert.match(markup, /&lt;img src=x onerror=&quot;bad&quot;&gt;/);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.match(markup, /href="https:\/\/source\.invalid\/item\?a=1&amp;b=2"/);
  assert.match(markup, /Recorded type: &lt;issuer &amp; &quot;claimed&quot;&gt;/);
  assert.doesNotMatch(markup, /javascript:bad/);
  assert.doesNotMatch(markup, /data-(approve|confirm|qualif)/);
  assert.equal(app.requests.length, 0);
});

test("funding section hides without P15 and stale or corrupt states replace prior company rows", async () => {
  const app = harness();
  app.reply(app.requests.shift(), snapshot(null));
  await tick(); await tick();
  const valid = snapshot("A");
  valid.funding = {
    state: "awaiting_qualification_factcheck", batch_id: "batch_aaaaaaaaaaaaaaaa",
    candidate_count: 1, provisional_match_count: 0, provisional_excluded_count: 0,
    unknown_count: 1, collision_count: 0, provisional_shortfall: 2,
    companies: [{name: "Prior Synthetic Company", provisional_state: "unknown",
      reason_codes: ["current_coverage_missing"], latest_stage: null,
      latest_announced_at: null, sources: []}],
  };
  app.evaluate('state.campaign="A"; globalThis.validFunding=load("A")');
  app.reply(app.requests.shift(), valid);
  await app.context.validFunding;
  assert.match(app.document.getElementById("campaignDetail").innerHTML, /Prior Synthetic Company/);

  const stale = snapshot("A");
  stale.funding = {state: "source_stale", code: "source_stale", companies: []};
  app.evaluate('globalThis.staleFunding=load("A")');
  app.reply(app.requests.shift(), stale);
  await app.context.staleFunding;
  let markup = app.document.getElementById("campaignDetail").innerHTML;
  assert.match(markup, /Saved evidence expired/);
  assert.doesNotMatch(markup, /Prior Synthetic Company/);

  const corrupt = snapshot("A");
  corrupt.funding = {state: "unavailable", code: "source_changed", companies: []};
  app.evaluate('globalThis.corruptFunding=load("A")');
  app.reply(app.requests.shift(), corrupt);
  await app.context.corruptFunding;
  markup = app.document.getElementById("campaignDetail").innerHTML;
  assert.match(markup, /Funding view unavailable/);
  assert.match(markup, /source changed/);
  assert.doesNotMatch(markup, /Prior Synthetic Company/);

  const hidden = snapshot("A");
  app.evaluate('globalThis.hiddenFunding=load("A")');
  app.reply(app.requests.shift(), hidden);
  await app.context.hiddenFunding;
  markup = app.document.getElementById("campaignDetail").innerHTML;
  assert.doesNotMatch(markup, /Funding evidence/);
  assert.doesNotMatch(markup, /Prior Synthetic Company/);
  assert.equal(app.requests.length, 0);
});
