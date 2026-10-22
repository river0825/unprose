import{p as k,i as m,a as f,b as y}from"./public-api-DL0se-Iz.js";import{a as v,u as b}from"./index-DPBN5nR4.js";function p(t){return/^[\p{L}\p{N}][\p{L}\p{N} _.,'()/&+-]*$/u.test(t)&&!/^(true|false|null|yes|no|on|off|~)$/i.test(t)&&!/^[-+]?(\d|\.\d)/.test(t)&&!/\s$/.test(t)&&!/: |\s#/.test(t)?t:JSON.stringify(t)}const x=(t,e,s,n)=>t.slice(0,e)+n+t.slice(s),S=(t,e)=>t.lastIndexOf(`
`,e-1)+1;function $(t,e){if(e>0&&t[e-1]===`
`)return e;const s=t.indexOf(`
`,e);return s<0?t.length:s+1}function E(t,e){const s=k(t,{keepSourceTokens:!0});if(s.errors.length)throw new Error(`the file is not valid YAML: ${s.errors[0].message}`);const n=s.contents;if(n!==null&&!m(n))throw new Error("the file is not a YAML map");const i=r=>`${r}- on: ${p(e.on)}
${r}  text: ${p(e.text)}
`,a=m(n)?n.items.find(r=>f(r.key)&&r.key.value==="annotations"):void 0;if(!a)return`${t.length&&!t.endsWith(`
`)?`${t}
`:t}annotations:
${i("  ")}`;const c=f(a.key)&&a.key.range?a.key.range[1]:void 0,o=a.value;if((o===null||f(o)&&o.value===null||y(o)&&o.flow&&o.items.length===0)&&c!==void 0){const r=t.indexOf(":",c),u=o&&o.range?o.range[1]:r+1;return x(t,r+1,$(t,u),`
${i("  ")}`)}if(!y(o))throw new Error("`annotations` in the file is not a list");const d=o.items[0],g=o.items[o.items.length-1];if(!o.flow&&d?.range&&g?.range){const r=d.range[0],u=t.slice(S(t,r),r);if(/^ *- +$/.test(u)){const l=$(t,g.range[1]),w=l===t.length&&!t.endsWith(`
`)?`
`:"";return x(t,l,l,w+i(" ".repeat(u.indexOf("-"))))}}return s.addIn(["annotations"],{on:e.on,text:e.text}),String(s)}function L(t,e,s){const n=v(t,e);if(n.kind==="board")return;const i={draft:!0,on:n.on,...n.file?{file:n.file}:{}},a={about:[e.id]},c={...n.file?{file:n.file}:{},...n.holder?{holder:n.holder}:{}};if(n.text===void 0||!n.file)return{data:{annotation:i,discuss:a},...c,...n.why?{why:n.why}:{}};let o;try{o=E(n.text,{on:n.on,text:s.trim()})}catch(d){return{data:{annotation:i,discuss:a},...c,why:`${n.file} could not take the entry (${d instanceof Error?d.message:String(d)})`}}const h=b(n.text,o,n.file);return{data:{annotation:i,discuss:{...a,edit:{file:n.file,base:"",diff:h}}},baseText:n.text,...c}}function D(t,e){const s=t.data.discuss;return s?.edit?{...t.data,discuss:{...s,edit:{...s.edit,base:e}}}:t.data}export{L as annotationDraft,D as withBase};
