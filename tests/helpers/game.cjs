const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

function fixture(initial = 100){
  const elements = new Map();
  const intervals = [];
  const events = {};
  const calls = [];
  const model = {best: initial, failPost: false, invalid: false, beforeGet: null};
  function element(id){
    if(!elements.has(id)){
      const classes = new Set(['hidden']);
      elements.set(id, {
        textContent: '', style: {}, clientWidth:800, clientHeight:600,
        classList: {
          add: name=>classes.add(name), remove: name=>classes.delete(name),
          contains: name=>classes.has(name),
          toggle(name, hidden){ if(hidden) classes.add(name); else classes.delete(name); }
        },
        getContext: ()=>({setTransform(){}}),
        getBoundingClientRect: ()=>({width: 800, height: 600}),
        addEventListener(){}
      });
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    document: {getElementById: element, hidden: false,
      addEventListener: (name, callback)=>{events[name] = callback;}},
    window: {devicePixelRatio: 1, addEventListener: (name, callback)=>{events[name] = callback;}},
    // Любое обращение к старому браузерному рекорду ломает тест.
    localStorage: {getItem(){throw new Error('localStorage не должен читаться');}},
    ResizeObserver: class {observe(){}}, performance: {now: ()=>0},
    requestAnimationFrame(){}, setInterval: fn=>intervals.push(fn),
    setTimeout, clearTimeout, AbortController,
    console: {error(){}, warn(){}}, alert(){},
    fetch: async (url, options)=>{
      calls.push({url, method: options.method || 'GET', body: options.body});
      if(options.method === 'POST'){
        if(model.failPost) return {ok:false, status:500};
        model.best = Math.max(model.best, JSON.parse(options.body).score);
      }
      const value = model.best;
      if(options.method !== 'POST' && model.beforeGet) await model.beforeGet();
      return {ok:true, json: async ()=>({bestScore: model.invalid ? '950' : value})};
    }
  });
  vm.runInContext(source, context);
  vm.runInContext('soundEnd = ()=>{}; soundRecord = ()=>{}; soundStart = ()=>{};', context);
  return {model, calls, intervals, events, element, run: code=>vm.runInContext(code, context)};
}

module.exports = {fixture, source};
