#!/usr/bin/env python3
"""CLAP ranking for sfx-forge. CLAP is the 'ear' — a pre-trained proxy that RANKS, it does not
pick (T4/T5). Deterministic (eval + no_grad + pinned model). rank() is pure + injectable for tests."""
from pathlib import Path


def rank(candidates, scorer=None):
    scorer = scorer or (lambda c: None)
    scored = []
    for c in candidates:
        s = scorer(c)
        d = dict(c); d["clap"] = s
        scored.append(d)
    scored.sort(key=lambda c: (-(c["clap"] if c["clap"] is not None else -1.0), -c.get("quality", 0.0), c["id"]))
    return scored


def load_clap(model_id="laion/clap-htsat-unfused"):
    try:
        import torch  # noqa: F401
        from transformers import ClapModel, ClapProcessor
    except Exception:
        return None
    model = ClapModel.from_pretrained(model_id).eval()
    proc = ClapProcessor.from_pretrained(model_id)
    return (model, proc)


def clap_scores(model_proc, wav_paths, prompts):
    """Per-audio max cosine similarity across the role's text prompts. transformers 5.x: the
    projected embeddings come from the FULL forward (`.text_embeds`/`.audio_embeds`) — the
    separate `get_text_features`/`get_audio_features` return encoder pooling objects, not the
    projection. CLAP's two towers are independent, so one batched forward scores every clip."""
    import torch, librosa
    if not wav_paths:
        return []
    model, proc = model_proc
    auds = [librosa.load(str(wp), sr=48000, mono=True)[0] for wp in wav_paths]   # T8: 48 kHz mono
    ti = proc(text=prompts, return_tensors="pt", padding=True)
    ai = proc(audio=auds, sampling_rate=48000, return_tensors="pt")
    with torch.no_grad():
        out = model(input_ids=ti["input_ids"], attention_mask=ti["attention_mask"],
                    input_features=ai["input_features"])
        temb = out.text_embeds; temb = temb / temb.norm(dim=-1, keepdim=True)
        aemb = out.audio_embeds; aemb = aemb / aemb.norm(dim=-1, keepdim=True)
        sims = (aemb @ temb.T).max(dim=1).values.tolist()          # per-audio max over prompts
    return [round(float(s), 4) for s in sims]
