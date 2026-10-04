'use strict';

const PLANS = {
  hobby: { id: 'hobby', name: 'Hobby', price: 0, credits: 50 },
  plus: { id: 'plus', name: 'Plus', price: 10, credits: 150 },
};
const MESSAGE_COST = 5;
const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// Credit ledger. Billing here is a demo: upgrading never touches a payment
// processor, and no card details are ever passed to (or stored by) this class.
class Account {
  constructor(file, now = Date.now) {
    this.file = file;
    this.now = now;
    const saved = file.read({});
    this.state = {
      plan: PLANS[saved.plan] ? saved.plan : 'hobby',
      credits: Number.isFinite(saved.credits) ? saved.credits : PLANS.hobby.credits,
      periodStart: Number.isFinite(saved.periodStart) ? saved.periodStart : now(),
    };
    this._rollover();
    this._save();
  }

  _save() {
    this.file.write(this.state);
  }

  // Credits refill (not accumulate) every 30 days.
  _rollover() {
    const t = this.now();
    if (t - this.state.periodStart >= PERIOD_MS) {
      const periods = Math.floor((t - this.state.periodStart) / PERIOD_MS);
      this.state.periodStart += periods * PERIOD_MS;
      this.state.credits = PLANS[this.state.plan].credits;
      return true;
    }
    return false;
  }

  snapshot() {
    if (this._rollover()) this._save();
    const plan = PLANS[this.state.plan];
    return {
      plan: plan.id,
      planName: plan.name,
      price: plan.price,
      credits: this.state.credits,
      allowance: plan.credits,
      cost: MESSAGE_COST,
      resetsAt: this.state.periodStart + PERIOD_MS,
    };
  }

  canAfford(cost = MESSAGE_COST) {
    return this.snapshot().credits >= cost;
  }

  // Credits are taken up front and handed back if the request fails.
  reserve(cost = MESSAGE_COST) {
    if (!this.canAfford(cost)) return false;
    this.state.credits -= cost;
    this._save();
    return true;
  }

  refund(cost = MESSAGE_COST) {
    const max = PLANS[this.state.plan].credits;
    this.state.credits = Math.min(max, this.state.credits + cost);
    this._save();
  }

  upgrade() {
    this.state.plan = 'plus';
    this.state.credits = PLANS.plus.credits;
    this.state.periodStart = this.now();
    this._save();
    return this.snapshot();
  }

  cancel() {
    this.state.plan = 'hobby';
    this.state.credits = Math.min(this.state.credits, PLANS.hobby.credits);
    this._save();
    return this.snapshot();
  }

  reset() {
    this.state = { plan: 'hobby', credits: PLANS.hobby.credits, periodStart: this.now() };
    this._save();
    return this.snapshot();
  }
}

module.exports = { Account, PLANS, MESSAGE_COST, PERIOD_MS };
