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
    people: [], schedule: [], activity: [], next_action: {},
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
  app.reply(loadB, snapshot("B"));
  await app.context.loadB;
  app.reply(loadA, snapshot("A"));
  await app.context.loadA;
  assert.equal(app.evaluate("state.campaign"), "B");
  assert.equal(app.evaluate("state.data.campaign.campaign_id"), "B");
  assert.equal(app.document.getElementById("draftSubject").value, "Server subject");

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
  assert.match(afterBlank.document.getElementById("draftList").innerHTML, /No drafts yet/);
  afterBlank.reply(pending, snapshot(null));
  await tick(); await tick();
});
