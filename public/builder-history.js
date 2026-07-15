(function exposeBuilderHistory(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FormspearBuilderHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createBuilderHistoryModule() {
  class BuilderHistory {
    constructor(limit = 50) {
      this.limit = Math.max(1, Number(limit || 50));
      this.reset();
    }

    remember(snapshot) {
      const serialized = JSON.stringify(snapshot);
      if (this.past[this.past.length - 1] === serialized) return false;
      this.past.push(serialized);
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
      return true;
    }

    undo(current) {
      if (!this.past.length) return null;
      this.future.push(JSON.stringify(current));
      return JSON.parse(this.past.pop());
    }

    redo(current) {
      if (!this.future.length) return null;
      this.past.push(JSON.stringify(current));
      return JSON.parse(this.future.pop());
    }

    reset() {
      this.past = [];
      this.future = [];
    }

    get canUndo() {
      return this.past.length > 0;
    }

    get canRedo() {
      return this.future.length > 0;
    }
  }

  return { BuilderHistory };
});
