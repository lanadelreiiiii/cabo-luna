// Cabo Luna — InkJS mission manager (Day 3A, written fresh in-session).
// Narrative lives in the .ink stories; gameplay lives in the game
// modules. The two meet ONLY through the adapter passed to
// createMissionManager(ink, adapter) — this file never imports a game
// module and never reads game internals. The ink runtime ({Story,
// Compiler}) is injected so the same code runs in Node and the browser.
//
// Story contract: knots `start`, one `<objectiveId>_done` knot per
// objective, plus `complete` and `failed`. A stage ends with a line
// tagged `# objective:<id>` then `-> END`; the manager watches the
// adapter until that objective is met, then diverts to `<id>_done`.
// `complete` carries `# mission_complete` and sets `payout` (or a
// `# reward:<n>` tag). Optional tags: `# checkpoint`, `# crime:<type>`
// (applied once via the adapter), `# objective_text:<...>` (HUD line).
// Choices may set ink variables; the manifest `branches` table maps
// them to objective parameters.
export function createMissionManager(ink, adapter, opts = {}) {
  if (!ink?.Story || !ink?.Compiler) {
    throw new Error('createMissionManager: ink runtime {Story, Compiler} required');
  }
  if (!adapter || typeof adapter.getPlayer !== 'function' || typeof adapter.getWanted !== 'function') {
    throw new Error('createMissionManager: adapter with getPlayer()/getWanted() required');
  }
  return new MissionManager(ink, adapter, opts);
}

class MissionManager {
  constructor(ink, adapter, opts = {}) {
    this.ink = ink;
    this.adapter = adapter;
    this.log = opts.log ?? (() => {});
    this.missionId = null;
    this.manifest = null;
    this.story = null;
    this.status = 'idle'; // idle | active | completed | failed
    this.stage = null; // current objective id, null while in dialogue
    this.objectivesDone = [];
    this.checkpoints = [];
    this.elapsed = 0;
    this.lines = [];
    this.choices = [];
    this.failReason = null;
    this.rewardPaid = 0;
    this._timer = 0; // per-objective timer (wait / lose_tail)
    this._stageStart = 0; // elapsed at the current stage start (timed_reach deadline)
    this._wantedSeen = false;
    this._killBaseline = 0; // combat kills when the current stage started
    this._crimesApplied = new Set();
  }

  loadCompiled(missionId, manifest, compiledJson) {
    if (!manifest || !Array.isArray(manifest.objectives)) {
      throw new Error(`loadCompiled(${missionId}): manifest with objectives[] required`);
    }
    const json = typeof compiledJson === 'string' ? compiledJson : JSON.stringify(compiledJson);
    this.story = new this.ink.Story(json);
    this._resetRun(missionId, manifest);
    return this;
  }

  loadMission(missionId, manifest, inkSource) {
    if (!manifest || !Array.isArray(manifest.objectives)) {
      throw new Error(`loadMission(${missionId}): manifest with objectives[] required`);
    }
    if (typeof inkSource !== 'string' || !inkSource.includes('=== start ===')) {
      throw new Error(`loadMission(${missionId}): ink source must contain a 'start' knot`);
    }
    let story;
    try {
      story = new this.ink.Compiler(inkSource).Compile();
    } catch (e) {
      throw new Error(`loadMission(${missionId}): ink compile failed: ${e.message}`);
    }
    this.story = story;
    this._resetRun(missionId, manifest);
    return this;
  }

  _resetRun(missionId, manifest) {
    this.missionId = missionId;
    this.manifest = manifest;
    this.status = 'idle';
    this.stage = null;
    this.objectivesDone = [];
    this.checkpoints = [];
    this.elapsed = 0;
    this.lines = [];
    this.choices = [];
    this.failReason = null;
    this.rewardPaid = 0;
    this._timer = 0;
    this._wantedSeen = false;
    this._crimesApplied = new Set();
  }

  start() {
    if (!this.story) throw new Error('start(): no mission loaded');
    if (this.status !== 'idle') throw new Error(`start(): mission already ${this.status}`);
    this.status = 'active';
    return this.advance();
  }

  // Run the story until it stops at choices or ends. Lines, tags and
  // choices from this advance are kept for the HUD.
  advance() {
    const lines = [];
    let guard = 0;
    while (this.story.canContinue && guard++ < 500) {
      const text = this.story.Continue();
      const tags = [...(this.story.currentTags ?? [])];
      if (text && text.trim()) lines.push({ text: text.trim(), tags });
      this.applyTags(tags);
      if (tags.includes('mission_complete')) {
        this.lines = lines;
        this.choices = [];
        this.complete();
        return this.snapshot();
      }
    }
    if (guard >= 500) throw new Error(`advance(): story did not stop after 500 continues (${this.missionId})`);
    this.lines = lines;
    this.choices = (this.story.currentChoices ?? []).map((c, i) => ({ index: i, text: c.text }));
    // A choice just made may have set a branch variable (route, hideout)
    // — resolve branch params before reading the new objective tag.
    this.resolveBranchParams();
    const objTag = lines.flatMap((l) => l.tags).filter((t) => t.startsWith('objective:')).pop();
    if (objTag) this.setStage(objTag.slice('objective:'.length));
    return this.snapshot();
  }

  choose(index) {
    if (this.status !== 'active') throw new Error(`choose(): mission is ${this.status}`);
    if (!this.choices[index]) throw new Error(`choose(${index}): no such choice (have ${this.choices.length})`);
    this.story.ChooseChoiceIndex(index);
    return this.advance();
  }

  // Tag side effects go through the adapter only.
  applyTags(tags) {
    for (const tag of tags) {
      if (tag.startsWith('crime:')) {
        const type = tag.slice('crime:'.length);
        const key = `${this.stage ?? 'start'}:${type}`;
        if (!this._crimesApplied.has(key) && typeof this.adapter.addCrime === 'function') {
          this._crimesApplied.add(key);
          this.adapter.addCrime(type);
        }
      }
      if (tag.startsWith('objective_text:') && typeof this.adapter.setObjectiveText === 'function') {
        this.adapter.setObjectiveText(tag.slice('objective_text:'.length));
      }
      if (tag === 'checkpoint') this.saveCheckpoint();
    }
  }

  setStage(objectiveId) {
    const def = this.manifest.objectives.find((o) => o.id === objectiveId);
    if (!def) throw new Error(`setStage(): manifest has no objective '${objectiveId}' (mission ${this.missionId})`);
    this.stage = objectiveId;
    this._timer = 0;
    this._stageStart = this.elapsed; // timed_reach deadline is measured from here
    this._killBaseline = typeof this.adapter.getCombatKills === 'function'
      ? this.adapter.getCombatKills() : 0;
    if (typeof this.adapter.setObjectiveText === 'function' && def.hud) {
      this.adapter.setObjectiveText(def.hud);
    }
  }

  // Manifest `branches: { <inkVar>: { <value>: { objectiveId: params } } }`
  // — after a choice sets an ink variable, matching params override the
  // base objective definition. Pure data merge, no game knowledge.
  resolveBranchParams() {
    for (const [varName, byValue] of Object.entries(this.manifest.branches ?? {})) {
      const value = this.getVariable(varName);
      if (value == null || value === '') continue;
      const overrides = byValue[String(value)];
      if (!overrides) continue;
      for (const [objectiveId, params] of Object.entries(overrides)) {
        const def = this.manifest.objectives.find((o) => o.id === objectiveId);
        if (def) Object.assign(def, params);
      }
    }
  }

  getVariable(name) {
    try { return this.story.variablesState[name]; } catch { return undefined; }
  }

  setVariable(name, value) { this.story.variablesState[name] = value; }

  update(dt) {
    if (this.status !== 'active' || !this.stage) return this.snapshot();
    this.elapsed += dt;
    if (this.adapter.getWanted().level > 0) this._wantedSeen = true;
    // Fail conditions first — a bust or timeout ends the mission even
    // mid-objective.
    if (typeof this.adapter.isBusted === 'function' && this.adapter.isBusted()) {
      return this.fail('busted');
    }
    const timeout = this.manifest.fail?.timeout;
    if (typeof timeout === 'number' && this.elapsed > timeout) {
      return this.fail('timeout');
    }
    const def = this.manifest.objectives.find((o) => o.id === this.stage);
    if (!def) return this.snapshot();
    // Day 5A: a timed_reach stage fails the mission when its per-stage
    // clock runs out — the global timeout is not the only clock.
    if (def.kind === 'timed_reach' && typeof def.seconds === 'number'
      && this.elapsed - (this._stageStart ?? this.elapsed) > def.seconds) {
      return this.fail('too_slow');
    }
    if (this.checkObjective(def, dt)) return this.onObjectiveMet(def);
    return this.snapshot();
  }

  checkObjective(def, dt) {
    const player = this.adapter.getPlayer();
    switch (def.kind) {
      case 'reach':
      case 'timed_reach': // reach, with the per-stage deadline enforced in update()
        return Math.hypot(player.x - def.x, player.z - def.z) <= (def.radius ?? 10);
      case 'in_vehicle':
        return player.onFoot === false;
      case 'on_foot':
        return player.onFoot === true;
      case 'wait':
        this._timer += dt;
        return this._timer >= (def.seconds ?? 1);
      case 'lose_tail': {
        const chased = typeof this.adapter.isBeingChased === 'function'
          ? this.adapter.isBeingChased() : false;
        if (chased) { this._timer = 0; return false; }
        this._timer += dt;
        return this._timer >= (def.seconds ?? 5);
      }
      case 'wanted_clear':
        return this._wantedSeen && this.adapter.getWanted().level === 0;
      case 'defeat': {
        // Day 3B seam: counts combat kills since this stage started.
        // The adapter returns 0 until the combat system lands, so this
        // objective cannot complete in Day 3A (by design).
        const kills = typeof this.adapter.getCombatKills === 'function'
          ? this.adapter.getCombatKills() : 0;
        return kills - (this._killBaseline ?? 0) >= (def.count ?? 1);
      }
      default:
        throw new Error(`checkObjective(): unknown kind '${def.kind}' (objective ${def.id})`);
    }
  }

  onObjectiveMet(def) {
    if (!this.objectivesDone.includes(def.id)) this.objectivesDone.push(def.id);
    this.saveCheckpoint();
    const doneKnot = `${def.id}_done`;
    try {
      this.story.ChoosePathString(doneKnot);
    } catch (e) {
      throw new Error(`onObjectiveMet(${def.id}): missing knot '${doneKnot}': ${e.message}`);
    }
    this.stage = null;
    const out = this.advance();
    if (this.status === 'active' && !this.stage && this.choices.length === 0 && !this.story.canContinue) {
      throw new Error(`onObjectiveMet(${def.id}): story ended without next objective or completion`);
    }
    return out;
  }

  complete() {
    if (this.status !== 'active') return this.snapshot();
    let payout = 0;
    const payoutVar = this.getVariable('payout');
    if (typeof payoutVar === 'number' && payoutVar > 0) payout = payoutVar;
    if (!payout) {
      const rewardTag = this.lines.flatMap((l) => l.tags).find((t) => t.startsWith('reward:'));
      if (rewardTag) payout = parseInt(rewardTag.slice('reward:'.length), 10) || 0;
    }
    if (!payout && typeof this.manifest.reward === 'number') payout = this.manifest.reward;
    if (payout > 0 && typeof this.adapter.addMoney === 'function') this.adapter.addMoney(payout);
    this.rewardPaid = payout;
    this.status = 'completed';
    this.stage = null;
    this.saveCheckpoint();
    if (typeof this.adapter.setObjectiveText === 'function') {
      this.adapter.setObjectiveText('Mission complete');
    }
    return this.snapshot();
  }

  fail(reason) {
    if (this.status !== 'active') return this.snapshot();
    this.failReason = reason;
    this.status = 'failed';
    this.stage = null;
    try {
      this.setVariable('fail_reason', reason);
      this.story.ChoosePathString('failed');
      this.advance();
    } catch (e) {
      this.log(`fail(): could not divert to 'failed' knot: ${e.message}`);
    }
    if (typeof this.adapter.setObjectiveText === 'function') {
      this.adapter.setObjectiveText(`Mission failed: ${reason}`);
    }
    return this.snapshot();
  }

  saveCheckpoint() {
    if (!this.story) return null;
    const cp = {
      at: +this.elapsed.toFixed(2),
      stage: this.stage,
      objectivesDone: [...this.objectivesDone],
      inkState: this.story.state.ToJson(),
    };
    this.checkpoints.push(cp);
    return cp;
  }

  snapshot() {
    return {
      missionId: this.missionId,
      status: this.status,
      stage: this.stage,
      objectivesDone: [...this.objectivesDone],
      elapsed: +this.elapsed.toFixed(2),
      lines: this.lines,
      choices: this.choices,
      failReason: this.failReason,
      rewardPaid: this.rewardPaid,
    };
  }
}
