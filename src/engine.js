import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import puppeteer from "puppeteer-core";
import { z } from "zod";
import { renderPropIcon } from "./icon-library.js";
import { renderCharacterIllustration } from "./character-library.js";
const point=z.tuple([z.number().finite(),z.number().finite()]);
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
const styleSchema=z.object({skin:color.default("#f2c6a0"),shirt:color.default("#3678d4"),pants:color.default("#263858"),hair:color.default("#342820")}).default({});
const act=z.discriminatedUnion("act",[
 z.object({t:z.number().min(0),duration:z.number().positive().default(1),char:z.string(),act:z.literal("walkTo"),to:point}),
 z.object({t:z.number().min(0),duration:z.number().positive().default(1),char:z.string(),act:z.literal("wave"),hand:z.enum(["left","right"]).default("right")}),
 z.object({t:z.number().min(0),duration:z.number().positive().default(1),char:z.string(),act:z.literal("pick"),target:z.string()}),
 z.object({t:z.number().min(0),duration:z.number().positive().default(1),char:z.string(),act:z.literal("give"),target:z.string(),prop:z.string()}),
 z.object({t:z.number().min(0),duration:z.number().positive().default(1),char:z.string(),act:z.literal("sitOn"),target:z.string()}),
 z.object({t:z.number().min(0),duration:z.number().positive().default(1),char:z.string(),act:z.literal("react"),emotion:z.enum(["neutral","happy","sad","surprised","angry"])}),
 z.object({t:z.number().min(0),duration:z.number().positive().default(1),char:z.string(),act:z.literal("talk")}),
 z.object({t:z.number().min(0),duration:z.number().positive().default(1),char:z.string(),act:z.literal("idle")})
]);
export const StorySchema=z.object({
 version:z.literal("2.0").default("2.0"),title:z.string().default("KPE story"),
 project:z.object({width:z.number().int().min(240).max(1920).default(720),height:z.number().int().min(320).max(1920).default(1280),fps:z.number().int().min(12).max(30).default(24),duration:z.number().positive().max(180).optional()}).default({}),
 characters:z.array(z.object({id:z.string().min(1),rig:z.enum(["human_basic"]).default("human_basic"),position:point.optional(),style:styleSchema,emotion:z.enum(["neutral","happy","sad","surprised","angry"]).default("neutral")})).min(1),
 props:z.array(z.object({id:z.string().min(1),type:z.enum(["book","ball","cup","box","chair"]).default("book"),position:z.object({x:z.number().finite(),y:z.number().finite()}),color:color.optional()})).default([]),
 scenes:z.array(z.object({id:z.string().min(1),duration:z.number().positive(),background:z.enum(["library","park","room","plain"]).default("library"),actions:z.array(act).default([]),transition:z.enum(["none","fade","slide"]).default("none"),camera:z.object({x:z.number().finite().default(0),y:z.number().finite().default(0),zoom:z.number().min(.5).max(2).default(1),endX:z.number().finite().optional(),endY:z.number().finite().optional(),endZoom:z.number().min(.5).max(2).optional(),motion:z.enum(["static","push","pull","pan"]).default("static")}).default({})})).min(1)
});
export function validateStory(input){
 const r=StorySchema.safeParse(input);if(!r.success)throw new Error("Story validation failed: "+r.error.issues.map(x=>x.path.join(".")+": "+x.message).join("; "));
 const s=r.data,cs=new Set(s.characters.map(x=>x.id)),ps=new Set(s.props.map(x=>x.id));
 if(cs.size!==s.characters.length)throw new Error("Duplicate character id");if(ps.size!==s.props.length)throw new Error("Duplicate prop id");
 for(const [si,sc] of s.scenes.entries())for(const [ai,a] of sc.actions.entries()){
  if(!cs.has(a.char))throw new Error("Unknown character "+a.char+" in scene "+sc.id);
  if(a.act==="pick"&&!ps.has(a.target))throw new Error("Unknown prop "+a.target);
  if(a.act==="give"&&!cs.has(a.target))throw new Error("Unknown recipient "+a.target);
  if(a.act==="give"&&!ps.has(a.prop))throw new Error("Unknown prop "+a.prop);
  if(a.act==="sitOn"&&!ps.has(a.target))throw new Error("Unknown seat "+a.target);if(a.act==="sitOn"&&s.props.find(p=>p.id===a.target)?.type!=="chair")throw new Error("sitOn target must be a chair: "+a.target);
  if(a.t+a.duration>sc.duration+.001)throw new Error("Action extends past scene duration "+si+"/"+ai);
  if(a.act==="walkTo"&&(a.to[0]<-100||a.to[0]>s.project.width+100||a.to[1]<-100||a.to[1]>s.project.height+100))throw new Error("walkTo target outside safe frame");
 }
 const total=s.scenes.reduce((n,x)=>n+x.duration,0);if(s.project.duration!=null&&Math.abs(s.project.duration-total)>.02)throw new Error("project.duration must equal sum of scene durations");s.project.duration=total;return s;
}
export function solveTwoBoneIK(root,target,l1,l2,bend=1){
 if(![root.x,root.y,target.x,target.y,l1,l2].every(Number.isFinite))throw new TypeError("IK inputs must be finite");if(l1<=0||l2<=0)throw new RangeError("Bone lengths must be positive");
 const dx=target.x-root.x,dy=target.y-root.y,raw=Math.hypot(dx,dy),min=Math.abs(l1-l2)+1e-4,max=l1+l2-1e-4,d=Math.max(min,Math.min(max,raw||min)),angle=Math.atan2(dy||0,dx||1),ca=Math.max(-1,Math.min(1,(l1*l1+d*d-l2*l2)/(2*l1*d))),a=Math.acos(ca)*(bend>=0?1:-1);
 return {elbow:{x:root.x+l1*Math.cos(angle+a),y:root.y+l1*Math.sin(angle+a)},end:{x:root.x+d*Math.cos(angle),y:root.y+d*Math.sin(angle)},reachable:raw>=min&&raw<=max,distance:raw};
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,p)=>a+(b-a)*clamp(p,0,1),smooth=p=>{p=clamp(p,0,1);return p*p*(3-2*p);},prog=(a,t)=>clamp((t-a.t)/a.duration,0,1);
function starts(s,idx){const m=new Map(s.characters.map((c,i)=>[c.id,[...(c.position??(i===0?[160,920]:[520,920]))]]));for(let i=0;i<idx;i++)for(const a of [...s.scenes[i].actions].sort((a,b)=>a.t-b.t))if(a.act==="walkTo")m.set(a.char,[...a.to]);return m;}
export function evaluateScene(s,idx,time,continuity=null){
 const scene=s.scenes[idx];if(!scene)throw new Error("Unknown scene index");const t=clamp(time,0,scene.duration),globalTime=(continuity?.elapsed??0)+t,base=starts(s,idx),actions=[...scene.actions].sort((a,b)=>a.t-b.t),positions=new Map([...base].map(([k,v])=>[k,[...v]]));if(continuity?.characters)for(const [id,p] of Object.entries(continuity.characters))if(positions.has(id))positions.set(id,[p.x,p.y]);const emotions=new Map(s.characters.map(c=>[c.id,continuity?.characters?.[c.id]?.emotion??c.emotion??"neutral"]));
 for(const a of actions){if(a.act==="walkTo"&&t>=a.t){let from=positions.get(a.char)??base.get(a.char)??[160,920];for(const b of actions){if(b===a)break;if(b.char===a.char&&b.act==="walkTo"&&b.t+b.duration<=a.t)from=[...b.to];}const p=smooth(prog(a,t));positions.set(a.char,[mix(from[0],a.to[0],p),mix(from[1],a.to[1],p)]);}if(a.act==="react"&&t>=a.t)emotions.set(a.char,a.emotion);}
 const chars=new Map();for(const [i,c] of s.characters.entries()){const pos=positions.get(c.id)??[160+i*280,920],walk=actions.find(a=>a.char===c.id&&a.act==="walkTo"&&t>=a.t&&t<a.t+a.duration),wave=actions.find(a=>a.char===c.id&&a.act==="wave"&&t>=a.t&&t<a.t+a.duration),talk=actions.find(a=>a.char===c.id&&a.act==="talk"&&t>=a.t&&t<a.t+a.duration),sit=actions.find(a=>a.char===c.id&&a.act==="sitOn"&&t>=a.t),phase=walk?(t-walk.t)*Math.PI*7:0;let px=pos[0],py=pos[1]-(walk?Math.abs(Math.sin(phase))*4:Math.sin(globalTime*2.2+i)*2);if(sit){const seat=s.props.find(p=>p.id===sit.target);if(seat){px=seat.position.x-45;py=seat.position.y+28;}}chars.set(c.id,{id:c.id,x:px,y:py,style:c.style,emotion:emotions.get(c.id),walkPhase:phase,waveAmount:wave?smooth(prog(wave,t)):0,waveHand:wave?.hand??"right",wavePhase:wave?(t-wave.t)*Math.PI*6:0,talkAmount:talk?(0.25+Math.abs(Math.sin((t-talk.t)*14))*.75)*smooth(prog(talk,t))*smooth(1-prog(talk,t)):0,sitting:!!sit||!!continuity?.characters?.[c.id]?.sitting,baseY:sit?py:pos[1],armTarget:null,holding:[]});}
 const props=new Map(s.props.map(p=>{const prior=continuity?.props?.[p.id];return [p.id,{id:p.id,type:p.type,x:prior?.x??p.position.x,y:prior?.y??p.position.y,color:p.color??"#d94841",attachedTo:prior?.attachedTo??null}];}));
 for(const p of s.props){let owner=continuity?.props?.[p.id]?.attachedTo?.characterId??null;for(const a of actions){if(a.act==="pick"&&a.target===p.id&&t>=a.t+a.duration)owner=a.char;if(a.act==="give"&&a.prop===p.id&&t>=a.t)owner=prog(a,t)<.58?a.char:a.target;}const obj=props.get(p.id),pick=actions.find(a=>a.act==="pick"&&a.target===p.id&&t>=a.t&&t<a.t+a.duration),give=actions.find(a=>a.act==="give"&&a.prop===p.id&&t>=a.t&&t<a.t+a.duration);
  if(pick){const c=chars.get(pick.char),q=smooth(prog(pick,t)),h={x:c.x+58,y:c.y-82};obj.x=mix(p.position.x,h.x,q);obj.y=mix(p.position.y,h.y,q);c.armTarget={x:obj.x,y:obj.y};}
  if(owner){const c=chars.get(owner);if(give){const g=chars.get(give.char),r=chars.get(give.target),q=smooth(prog(give,t)),from={x:g.x+58,y:g.y-82},to={x:r.x-42,y:r.y-82};obj.x=mix(from.x,to.x,q);obj.y=mix(from.y,to.y,q);g.armTarget={x:obj.x,y:obj.y};r.armTarget={x:obj.x,y:obj.y};}else if(c){obj.x=c.x+58;obj.y=c.y-82;c.armTarget={x:obj.x,y:obj.y};}obj.attachedTo={characterId:owner,point:"hand_R"};if(c)c.holding.push(p.id);}
 }
 for(const c of chars.values()){const root={x:c.x+72,y:c.y-116},target=c.armTarget??(c.waveAmount>0?{x:c.x+104+Math.sin(t*18)*7,y:c.y-178}:{x:c.x+(c.holding.length?90:92),y:c.y-(c.holding.length?78:48)});c.ik=solveTwoBoneIK(root,target,43,40,1);}
 const camera=scene.camera??{x:0,y:0,zoom:1,motion:"static"};const cameraP=smooth(t/scene.duration),cameraTargetZoom=camera.endZoom??(camera.motion==="push"?1.12:camera.motion==="pull"?.9:camera.zoom),cameraTargetX=camera.endX??(camera.motion==="pan"?s.project.width*.08:camera.x),cameraTargetY=camera.endY??camera.y;return {time:t,globalTime,sceneIndex:idx,scene,characters:[...chars.values()],props:[...props.values()],camera:{x:mix(camera.x,cameraTargetX,cameraP),y:mix(camera.y,cameraTargetY,cameraP),zoom:mix(camera.zoom,cameraTargetZoom,cameraP)},width:s.project.width,height:s.project.height,transitionAlpha:scene.transition==="fade"?clamp((scene.duration-t)/.55,0,1):1,transitionProgress:scene.transition==="slide"?clamp((t-(scene.duration-.55))/.55,0,1):0};
}
function continuityFrom(state){return {elapsed:state.globalTime,characters:Object.fromEntries(state.characters.map(c=>[c.id,{x:c.x,y:c.baseY??c.y,sitting:c.sitting,emotion:c.emotion}])),props:Object.fromEntries(state.props.map(p=>[p.id,{x:p.x,y:p.y,attachedTo:p.attachedTo}]))};}
export function evaluateStory(s,time){let off=0,continuity=null;const target=Math.max(0,Number.isFinite(time)?time:0);for(let i=0;i<s.scenes.length;i++){const end=off+s.scenes[i].duration;if(target<=end||i===s.scenes.length-1)return evaluateScene(s,i,target-off,continuity);const completed=evaluateScene(s,i,s.scenes[i].duration,continuity);continuity=continuityFrom(completed);off=end;}return evaluateScene(s,s.scenes.length-1,s.scenes.at(-1).duration,continuity);}
const esc=x=>String(x).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"),n=x=>Number.isFinite(x)?Number(x.toFixed(2)):0;
const line=(x1,y1,x2,y2,c,w)=>'<line x1="'+n(x1)+'" y1="'+n(y1)+'" x2="'+n(x2)+'" y2="'+n(y2)+'" stroke="'+c+'" stroke-width="'+w+'" stroke-linecap="round"/>';
export function renderBackground(name,w,h){
 const floorY=Math.round(h*.83),park=name==="park",room=name==="room",plain=name==="plain";
 const wall=park?"#cce8d2":room?"#eee3d5":plain?"#f5f0e6":"#efe5d4";
 const floor=park?"#72a967":room?"#b98c68":plain?"#e9dfce":"#c9a780";
 let o='<defs>'+
 '<linearGradient id="kpe-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+(park?"#dff2e1":room?"#f7eee2":plain?"#fbf8f0":"#f8efdf")+'"/><stop offset="1" stop-color="'+wall+'"/></linearGradient>'+
 '<linearGradient id="kpe-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+floor+'"/><stop offset="1" stop-color="'+(park?"#579152":room?"#946849":plain?"#d8c9b5":"#a77b56")+'"/></linearGradient>'+
 '<linearGradient id="kpe-window" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c7e7f3"/><stop offset="1" stop-color="#77a9c8"/></linearGradient>'+
 '</defs><rect width="'+w+'" height="'+h+'" fill="url(#kpe-wall)"/>';
 if(name==="library"){
  // Tall arched window and soft sunbeams make the room read as a real place.
  o+='<path d="M'+(w*.68)+' '+(h*.08)+' Q'+(w*.82)+' '+(h*.015)+' '+(w*.94)+' '+(h*.08)+' V'+(h*.37)+' H'+(w*.68)+'Z" fill="#8d674c" stroke="#684a39" stroke-width="8"/>';
  o+='<path d="M'+(w*.7)+' '+(h*.09)+' Q'+(w*.82)+' '+(h*.04)+' '+(w*.92)+' '+(h*.09)+' V'+(h*.34)+' H'+(w*.7)+'Z" fill="url(#kpe-window)"/>';
  o+='<path d="M'+(w*.81)+' '+(h*.07)+' V'+(h*.34)+' M'+(w*.7)+' '+(h*.22)+' H'+(w*.92)+'" stroke="#f8f0dc" stroke-width="7"/>';
  o+='<path d="M'+(w*.71)+' '+(h*.1)+' L'+(w*.9)+' '+(h*.34)+' H'+(w*.8)+'Z" fill="#fff5c6" opacity=".18"/>';
  for(let r=0;r<3;r++){
   const y=h*(.19+r*.135),sx=30+r*7,sw=w-60-r*14;
   o+='<rect x="'+(sx-5)+'" y="'+(y+4)+'" width="'+(sw+10)+'" height="'+(h*.094)+'" rx="5" fill="#6b4633" opacity=".16"/>';
   o+='<rect x="'+sx+'" y="'+y+'" width="'+sw+'" height="'+(h*.088)+'" rx="5" fill="#9a6947" stroke="#65452f" stroke-width="3"/>';
   o+='<path d="M'+sx+' '+(y+7)+' H'+(sx+sw)+'" stroke="#c99564" stroke-width="3"/>';
   const palette=["#b94c45","#4c7192","#d6aa52","#587c65","#8b6a9b","#d17d43","#d5b69a"];
   let x=sx+12;while(x<sx+sw-18){const bw=19+((Math.floor(x)+r*7)%15),bh=h*(.058+((Math.floor(x/3)+r)%3)*.006);
    o+='<path d="M'+x+' '+(y-1)+' Q'+(x+bw/2)+' '+(y-7)+' '+(x+bw)+' '+(y-1)+' V'+(y+bh)+' H'+x+'Z" fill="'+palette[(Math.floor(x/13)+r*2)%palette.length]+'" stroke="#553c30" stroke-width="1.4"/>';
    o+='<path d="M'+(x+5)+' '+(y+5)+' V'+(y+bh-5)+'" stroke="#fff" stroke-width="2" opacity=".22"/>';x+=bw+5;
   }
  }
  o+='<path d="M20 '+(h*.63)+' Q'+(w*.18)+' '+(h*.57)+' '+(w*.36)+' '+(h*.63)+'" fill="none" stroke="#d7b98e" stroke-width="5" opacity=".55"/>';
 }else if(park){
  o+='<circle cx="'+(w*.82)+'" cy="'+(h*.13)+'" r="'+(w*.075)+'" fill="#f5d779"/><circle cx="'+(w*.82)+'" cy="'+(h*.13)+'" r="'+(w*.095)+'" fill="#f5d779" opacity=".18"/>';
  for(let i=0;i<4;i++){const cx=w*(.12+i*.27),cy=h*(.36+(i%2)*.055),r=w*(.09+(i%3)*.012);
   o+='<path d="M'+(cx-12)+' '+(cy+r*.55)+' L'+(cx-8)+' '+(floorY+12)+' H'+(cx+10)+' L'+(cx+12)+' '+(cy+r*.55)+'Z" fill="#76523a"/>';
   o+='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+(i%2?"#77b778":"#65a86d")+'"/><circle cx="'+(cx-r*.4)+'" cy="'+(cy-r*.25)+'" r="'+(r*.56)+'" fill="#91c987" opacity=".6"/>';
  }
  o+='<path d="M0 '+(h*.68)+' Q'+(w*.2)+' '+(h*.62)+' '+(w*.38)+' '+(h*.7)+' T'+w+' '+(h*.67)+' V'+h+' H0Z" fill="#9ac77c"/>';
  o+='<path d="M'+(w*.34)+' '+h+' Q'+(w*.47)+' '+(h*.79)+' '+(w*.54)+' '+floorY+' Q'+(w*.65)+' '+(h*.92)+' '+(w*.75)+' '+h+'Z" fill="#d9c69d" opacity=".85"/>';
  // A small bench anchors the background without competing with the characters.
  const bx=w*.68,by=h*.68;
  o+='<path d="M'+(bx-42)+' '+(by+20)+' L'+(bx-48)+' '+(by+67)+' M'+(bx+42)+' '+(by+20)+' L'+(bx+48)+' '+(by+67)+'" stroke="#76513a" stroke-width="9"/>';
  o+='<rect x="'+(bx-62)+'" y="'+by+'" width="124" height="16" rx="4" fill="#b77b45" stroke="#69462f" stroke-width="3"/><rect x="'+(bx-58)+'" y="'+(by-32)+'" width="116" height="12" rx="4" fill="#c58a50" stroke="#69462f" stroke-width="3"/>';
  for(let i=0;i<12;i++){const fx=(i*67+23)%w,fy=h*(.7+(i%4)*.045);o+='<path d="M'+fx+' '+fy+' v-13" stroke="#47834d" stroke-width="2"/><circle cx="'+(fx-4)+'" cy="'+(fy-14)+'" r="4" fill="'+(i%2?"#e8a6b1":"#f3d47a")+'"/><circle cx="'+(fx+4)+'" cy="'+(fy-15)+'" r="4" fill="'+(i%2?"#f2c4ca":"#fff0b0")+'"/>';}
 }else if(room){
  // Framed window, wall art and a side cabinet establish room scale.
  o+='<rect x="'+(w*.1)+'" y="'+(h*.13)+'" width="'+(w*.34)+'" height="'+(h*.25)+'" rx="4" fill="#fff7e8" stroke="#8b6a50" stroke-width="10"/>';
  o+='<rect x="'+(w*.115)+'" y="'+(h*.145)+'" width="'+(w*.31)+'" height="'+(h*.22)+'" fill="url(#kpe-window)"/>';
  o+='<path d="M'+(w*.27)+' '+(h*.145)+' V'+(h*.365)+' M'+(w*.115)+' '+(h*.255)+' H'+(w*.425)+'" stroke="#fff8e7" stroke-width="7"/>';
  o+='<path d="M'+(w*.115)+' '+(h*.33)+' Q'+(w*.19)+' '+(h*.25)+' '+(w*.26)+' '+(h*.33) +' T'+(w*.425)+' '+(h*.31)+'" fill="#8ab78a" opacity=".7"/>';
  o+='<rect x="'+(w*.67)+'" y="'+(h*.15)+'" width="'+(w*.19)+'" height="'+(h*.2)+'" rx="3" fill="#a97a54" stroke="#795237" stroke-width="7"/>';
  o+='<rect x="'+(w*.69)+'" y="'+(h*.17)+'" width="'+(w*.15)+'" height="'+(h*.16)+'" fill="#e7bd70"/><path d="M'+(w*.715)+' '+(h*.29)+' l20 -42 l23 42Z" fill="#668b70"/><circle cx="'+(w*.77)+'" cy="'+(h*.205)+'" r="10" fill="#f7e6b6"/>';
  const tx=w*.08,ty=h*.57;
  o+='<rect x="'+tx+'" y="'+ty+'" width="'+(w*.2)+'" height="'+(h*.11)+'" rx="5" fill="#c08b58" stroke="#795237" stroke-width="3"/><rect x="'+(tx+8)+'" y="'+(ty+8)+'" width="'+(w*.2-16)+'" height="'+(h*.075)+'" fill="#e8c58d"/><path d="M'+(tx+12)+' '+(ty+h*.04)+' Q'+(tx+w*.1)+' '+(ty-h*.015)+' '+(tx+w*.18)+' '+(ty+h*.07)+'" fill="none" stroke="#fff4d7" stroke-width="3"/>';
  o+='<rect x="'+(w*.76)+'" y="'+(h*.66)+'" width="'+(w*.17)+'" height="'+(h*.13)+'" rx="5" fill="#9b6c48"/><rect x="'+(w*.74)+'" y="'+(h*.64)+'" width="'+(w*.21)+'" height="12" rx="3" fill="#c08b58"/><path d="M'+(w*.78)+' '+(h*.79)+' v'+(h*.04)+' M'+(w*.91)+' '+(h*.79)+' v'+(h*.04)+'" stroke="#795237" stroke-width="8"/>';
 }else{
  for(let i=0;i<9;i++){const x=(i*97+31)%w,y=(i*173+81)%(floorY-30);o+='<circle cx="'+x+'" cy="'+y+'" r="'+(i%3+1)+'" fill="#b7a58e" opacity=".12"/>';}
 }
 o+='<rect y="'+floorY+'" width="'+w+'" height="'+(h-floorY)+'" fill="url(#kpe-floor)"/>';
 o+='<path d="M0 '+floorY+' H'+w+'" stroke="'+(park?"#4f8d4c":"#8c694b")+'" stroke-width="6"/>';
 if(!park){for(let i=1;i<7;i++){const y=floorY+(h-floorY)*i/7;o+='<path d="M0 '+y+' H'+w+'" stroke="#76583f" stroke-width="2" opacity=".2"/>';}for(let i=0;i<5;i++){const x=i*w/4;o+='<path d="M'+x+' '+floorY+' L'+(x+(i%2?35:-25))+' '+h+'" stroke="#76583f" stroke-width="2" opacity=".16"/>';}}
 o+='<ellipse cx="'+(w*.5)+'" cy="'+(h*.91)+'" rx="'+(w*.4)+'" ry="'+(h*.035)+'" fill="#4e3b2b" opacity=".07"/>';
 return o;
}
function face(c,x,y){const s=c.style;let o='<ellipse cx="'+x+'" cy="'+y+'" rx="35" ry="39" fill="'+s.skin+'" stroke="#5b4032" stroke-width="2"/><path d="M'+(x-34)+' '+(y-17)+' Q'+(x-25)+' '+(y-48)+' '+(x+12)+' '+(y-38)+' Q'+(x+34)+' '+(y-30)+' '+(x+34)+' '+(y-14)+' Q'+(x+9)+' '+(y-28)+' '+(x-3)+' '+(y-19)+' Q'+(x-20)+' '+(y-8)+' '+(x-34)+' '+(y-17)+'" fill="'+s.hair+'"/><ellipse cx="'+(x-12)+'" cy="'+(y-2)+'" rx="4" ry="5" fill="#2b2420"/><ellipse cx="'+(x+12)+'" cy="'+(y-2)+'" rx="4" ry="5" fill="#2b2420"/>';if(c.talkAmount>.12)o+='<ellipse cx="'+x+'" cy="'+(y+17)+'" rx="7" ry="'+(3+8*c.talkAmount)+'" fill="#7b3530"/>';else if(c.emotion==="happy")o+='<path d="M'+(x-12)+' '+(y+13)+' Q'+x+' '+(y+27)+' '+(x+13)+' '+(y+12)+'" fill="none" stroke="#7b3530" stroke-width="3"/>';else if(c.emotion==="sad")o+='<path d="M'+(x-12)+' '+(y+22)+' Q'+x+' '+(y+8)+' '+(x+13)+' '+(y+22)+'" fill="none" stroke="#7b3530" stroke-width="3"/>';else if(c.emotion==="surprised")o+='<ellipse cx="'+x+'" cy="'+(y+17)+'" rx="6" ry="8" fill="#7b3530"/>';else o+='<path d="M'+(x-10)+' '+(y+17)+'H'+(x+10)+'" stroke="#7b3530" stroke-width="3"/>';return o;}
function drawChar(c){return renderCharacterIllustration(c);}
function drawProp(p){return renderPropIcon(p);}

export function renderSvg(st){let content='<text x="36" y="55" font-size="26" font-family="Arial,sans-serif" font-weight="700" fill="#4a3829">'+esc(st.scene.id)+'</text>';for(const p of st.props)if(!p.attachedTo)content+=drawProp(p);for(const c of st.characters)content+=drawChar(c);for(const p of st.props)if(p.attachedTo)content+=drawProp(p);if(st.scene.transition==="slide"&&st.transitionProgress>0)content='<g transform="translate('+n(-st.width*st.transitionProgress)+' 0)">'+content+'</g>';const cam=st.camera??{x:0,y:0,zoom:1};content='<g transform="translate('+n(st.width/2+cam.x)+' '+n(st.height/2+cam.y)+') scale('+n(cam.zoom)+') translate('+n(-st.width/2)+' '+n(-st.height/2)+')">'+content+'</g>';let b=renderBackground(st.scene.background,st.width,st.height)+content;if(st.scene.transition==="fade"&&st.transitionAlpha<1)b+='<rect width="'+st.width+'" height="'+st.height+'" fill="#111827" opacity="'+n(1-st.transitionAlpha)+'"/>';return '<svg xmlns="http://www.w3.org/2000/svg" width="'+st.width+'" height="'+st.height+'" viewBox="0 0 '+st.width+' '+st.height+'">'+b+'</svg>';}
export function findChrome(){const paths=[process.env.CHROME_PATH,"/opt/chrome-linux64/chrome","/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/chrome"].filter(Boolean);for(const p of paths){try{fs.accessSync(p,fs.constants.X_OK);return p;}catch{}}for(const c of ["google-chrome","chromium","chromium-browser","chrome"]){const r=spawnSync("which",[c],{encoding:"utf8"});if(r.status===0&&r.stdout.trim())return r.stdout.trim();}throw new Error("Chrome/Chromium not found. Install Chrome for Testing or set CHROME_PATH.");}
export function checkFFmpeg(){const r=spawnSync("ffmpeg",["-version"],{encoding:"utf8"});if(r.status!==0)throw new Error("FFmpeg is not installed or not on PATH");return r.stdout.split("\n")[0].trim();}
async function encode({output,fps,format,count,frame}){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});const args=["-hide_banner","-loglevel","error","-y","-f","image2pipe","-vcodec",format==="jpeg"?"mjpeg":"png","-framerate",String(fps),"-i","pipe:0","-an","-c:v","libx264","-preset","ultrafast","-crf","23","-pix_fmt","yuv420p","-r",String(fps),"-movflags","+faststart",output],p=spawn("ffmpeg",args,{stdio:["pipe","ignore","pipe"]});let err="";p.stderr.setEncoding("utf8");p.stderr.on("data",d=>err+=d);const closed=once(p,"close");let bytes=0;try{for(let i=0;i<count;i++){const b=await frame(i);bytes+=b.length;if(!p.stdin.write(b))await once(p.stdin,"drain");}p.stdin.end();}catch(e){p.stdin.destroy();p.kill("SIGTERM");throw e;}const [code,signal]=await closed;if(code!==0)throw new Error("FFmpeg exit "+code+" ("+signal+"): "+err.trim());if(!fs.existsSync(output)||!fs.statSync(output).size)throw new Error("MP4 missing or empty");return {frames:count,inputBytes:bytes,outputBytes:fs.statSync(output).size};}
export async function renderStory(s,{output="output/kpe-demo.mp4",format="png",quality=85}={}){
 const ffmpegVersion=checkFFmpeg(),chrome=findChrome(),{width,height,fps}=s.project,count=Math.round(s.project.duration*fps),started=performance.now();
 let peakRss=process.memoryUsage().rss,browser;
 const sampler=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);sampler.unref();
 try{
  browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-setuid-sandbox","--disable-gpu","--disable-dev-shm-usage","--hide-scrollbars"]});
  const page=await browser.newPage();await page.setViewport({width,height,deviceScaleFactor:1});
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:'+width+'px;height:'+height+'px;overflow:hidden;background:#f4f0e8}#stage{width:'+width+'px;height:'+height+'px;overflow:hidden}svg{display:block;width:'+width+'px;height:'+height+'px}</style></head><body><div id="stage"></div></body></html>',{waitUntil:"load"});
  await page.evaluate(async()=>{await document.fonts.ready;window.__setSvg=x=>{document.getElementById("stage").innerHTML=x;};});
  const encoded=await encode({output,fps,format,count,frame:async i=>{await page.evaluate(svg=>window.__setSvg(svg),renderSvg(evaluateStory(s,i/fps)));return page.screenshot({type:format==="jpeg"?"jpeg":"png",quality:format==="jpeg"?quality:undefined,fullPage:false});}});
  peakRss=Math.max(peakRss,process.memoryUsage().rss);
  return {...encoded,renderSeconds:Number(((performance.now()-started)/1000).toFixed(2)),nodePeakRssMB:Number((peakRss/1048576).toFixed(1)),chrome,ffmpegVersion,width,height,fps,duration:s.project.duration,transport:format};
 }finally{clearInterval(sampler);if(browser)await browser.close();}
}
export function validateVideo(file,expected={}){if(!fs.existsSync(file)||!fs.statSync(file).size)throw new Error("Video missing or empty: "+file);const r=spawnSync("ffprobe",["-v","error","-count_frames","-select_streams","v:0","-show_entries","stream=codec_name,width,height,avg_frame_rate,nb_read_frames,duration","-show_entries","format=duration,size,format_name","-of","json",file],{encoding:"utf8"});if(r.status!==0)throw new Error("ffprobe failed: "+r.stderr);const d=JSON.parse(r.stdout),v=d.streams?.[0];if(!v)throw new Error("No video stream found");const fr=v.avg_frame_rate.split("/"),fps=Number(fr[0])/Number(fr[1]),report={valid:true,path:file,bytes:fs.statSync(file).size,codec:v.codec_name,width:v.width,height:v.height,fps:Number(fps.toFixed(3)),duration:Number(Number(v.duration??d.format.duration).toFixed(3)),frames:Number(v.nb_read_frames),format:d.format?.format_name},errors=[];for(const k of ["width","height","fps","duration","frames"])if(expected[k]!=null&&Math.abs(report[k]-expected[k])>(k==="duration"?1/Math.max(expected.fps??24,1)+.03:k==="fps"?.1:0))errors.push(k+" expected "+expected[k]+", got "+report[k]);if(errors.length)throw new Error("Video validation failed: "+errors.join("; "));return report;}
export async function generateStory(prompt,{model}={}){const key=process.env.KIOSAPI_API_KEY??process.env.KIOSAPI_SECRET??process.env.OPENAI_API_KEY;if(!key)throw new Error("No API key. Set KIOSAPI_API_KEY/KIOSAPI_SECRET or use --story.");const base=(process.env.KIOSAPI_BASE_URL??"https://kiosapi.com/v1").replace(/\/$/,""),chosen=model??process.env.KIOSAPI_MODEL??"deepseek-ai/deepseek-v4.1-flash",system="Return only JSON for KPE v2. version 2.0; project 720x1280, 24fps, 6-20 seconds. Use characters with id and hex skin/shirt/pants/hair; props with id,type,position; scenes with id,duration,background (library|park|room|plain),actions,transition (none|fade|slide), and optional camera {x,y,zoom,endX,endY,endZoom,motion}, where motion is static|push|pull|pan. Use push for a gentle zoom-in, pull for zoom-out, pan for a lateral camera move. Props render as reusable illustrated SVG icons. Actions: walkTo(to:[x,y]), wave, pick(target prop), give(target character and prop), sitOn(target prop), react(emotion), talk, idle. Each action needs t,duration,char,act. IDs must exist, action end times must fit scene, scene durations must sum to project.duration, coordinates must be inside frame. Use a readable short story. Example JSON object shape: {\"version\":\"2.0\",\"title\":\"Story\",\"project\":{\"width\":720,\"height\":1280,\"fps\":24,\"duration\":8},\"characters\":[{\"id\":\"A\",\"position\":[160,920],\"style\":{\"skin\":\"#f2c6a0\",\"shirt\":\"#3678d4\",\"pants\":\"#263858\",\"hair\":\"#342820\"}}],\"props\":[{\"id\":\"book\",\"type\":\"book\",\"position\":{\"x\":420,\"y\":900}}],\"scenes\":[{\"id\":\"scene1\",\"duration\":8,\"background\":\"library\",\"actions\":[],\"transition\":\"fade\"}]}";const res=await fetch(base+"/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:chosen,messages:[{role:"system",content:system},{role:"user",content:"Create a short animation plan for: "+prompt}],temperature:.2,response_format:{type:"json_object"}}),signal:AbortSignal.timeout(90000)});if(!res.ok)throw new Error("KiosAPI HTTP "+res.status+": "+(await res.text()).slice(0,300));const data=await res.json(),text=data.choices?.[0]?.message?.content;if(!text)throw new Error("KiosAPI returned empty content");let raw;try{raw=JSON.parse(text.trim());}catch{const a=text.indexOf("{"),b=text.lastIndexOf("}");if(a<0||b<=a)throw new Error("Model did not return JSON");raw=JSON.parse(text.slice(a,b+1));}return {story:validateStory(raw),model:data.model??chosen,usage:data.usage??null};}
