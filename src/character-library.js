// Reusable, CPU-friendly illustrated character artwork. Coordinates use the character's feet as the origin.
const num = v => Number.isFinite(v) ? Number(v.toFixed(2)) : 0;
const line = (a,b,c,d,color,width,extra="") =>
  '<path d="M'+num(a)+' '+num(b)+' L'+num(c)+' '+num(d)+'" fill="none" stroke="'+color+'" stroke-width="'+width+'" stroke-linecap="round" stroke-linejoin="round" '+extra+'/>';
const path = (d,fill,stroke="#49372f",width=2) =>
  '<path d="'+d+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+width+'" stroke-linejoin="round" stroke-linecap="round"/>';
const safe = (s,fallback) => /^#[0-9a-f]{6}$/i.test(s||"") ? s : fallback;
const esc = s => String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

function drawFace(c,cx,cy,skin,hair){
  let out = '<ellipse cx="'+cx+'" cy="'+cy+'" rx="34" ry="38" fill="'+skin+'" stroke="#573d32" stroke-width="2.4"/>';
  out += '<ellipse cx="'+(cx-34)+'" cy="'+(cy+2)+'" rx="5" ry="9" fill="'+skin+'" stroke="#573d32" stroke-width="2"/>';
  out += '<ellipse cx="'+(cx+34)+'" cy="'+(cy+2)+'" rx="5" ry="9" fill="'+skin+'" stroke="#573d32" stroke-width="2"/>';
  out += path('M'+(cx-34)+' '+(cy-15)+' Q'+(cx-39)+' '+(cy-44)+' '+(cx-9)+' '+(cy-44)+' Q'+(cx+20)+' '+(cy-53)+' '+(cx+34)+' '+(cy-29)+' L'+(cx+32)+' '+(cy-11)+' Q'+(cx+15)+' '+(cy-27)+' '+(cx-1)+' '+(cy-21)+' Q'+(cx-18)+' '+(cy-12)+' '+(cx-34)+' '+(cy-15)+'Z',hair,"#49372f",2);
  out += line(cx-19,cy-9,cx-8,cy-11,"#49372f",2.5) + line(cx+8,cy-11,cx+19,cy-9,"#49372f",2.5);
  out += '<ellipse cx="'+(cx-13)+'" cy="'+(cy-2)+'" rx="3.5" ry="4.5" fill="#282326"/><ellipse cx="'+(cx+13)+'" cy="'+(cy-2)+'" rx="3.5" ry="4.5" fill="#282326"/>';
  out += '<circle cx="'+(cx-14)+'" cy="'+(cy-3)+'" r="1.2" fill="#fff"/><circle cx="'+(cx+12)+'" cy="'+(cy-3)+'" r="1.2" fill="#fff"/>';
  out += '<path d="M'+cx+' '+(cy+1)+' l-3 8 l5 1" fill="none" stroke="#bd876b" stroke-width="1.8" stroke-linecap="round"/>';
  out += '<ellipse cx="'+(cx-20)+'" cy="'+(cy+12)+'" rx="6" ry="3" fill="#d97870" opacity=".28"/><ellipse cx="'+(cx+20)+'" cy="'+(cy+12)+'" rx="6" ry="3" fill="#d97870" opacity=".28"/>';
  if(c.talkAmount>.12) out += '<ellipse cx="'+cx+'" cy="'+(cy+18)+'" rx="6" ry="'+(3+6*c.talkAmount)+'" fill="#7b3530"/>';
  else if(c.emotion==="happy") out += '<path d="M'+(cx-10)+' '+(cy+15)+' Q'+cx+' '+(cy+27)+' '+(cx+10)+' '+(cy+15)+'" fill="#fff" stroke="#7b3530" stroke-width="2.5"/>';
  else if(c.emotion==="sad") out += '<path d="M'+(cx-10)+' '+(cy+22)+' Q'+cx+' '+(cy+12)+' '+(cx+10)+' '+(cy+22)+'" fill="none" stroke="#7b3530" stroke-width="2.8"/>';
  else if(c.emotion==="surprised") out += '<ellipse cx="'+cx+'" cy="'+(cy+17)+'" rx="5" ry="7" fill="#7b3530"/>';
  else if(c.emotion==="angry") out += line(cx-10,cy+18,cx+10,cy+18,"#7b3530",2.8);
  else out += '<path d="M'+(cx-8)+' '+(cy+17)+' Q'+cx+' '+(cy+20)+' '+(cx+8)+' '+(cy+17)+'" fill="none" stroke="#7b3530" stroke-width="2.5"/>';
  return out;
}

export function renderCharacterIllustration(c){
  const x=c.x,y=c.y,s=c.style||{};
  const skin=safe(s.skin,"#f2c6a0"),shirt=safe(s.shirt,"#3678d4"),pants=safe(s.pants,"#263858"),hair=safe(s.hair,"#342820");
  const hx=x+42,hy=y-169,walk=c.walkPhase||0,step=Math.sin(walk),bob=Math.abs(Math.sin(walk))*2.5;
  const leftWave=c.waveAmount>0&&c.waveHand==="left";
  const lx=leftWave?x-26+Math.sin(c.wavePhase)*7:x-5,ly=leftWave?y-181:y-48;
  const el=c.ik?.elbow||{x:x+93,y:y-78},hand=c.ik?.end||{x:x+92,y:y-48};
  let out='<g class="kpe-character" data-character="'+esc(c.id)+'">';
  out += '<ellipse cx="'+(x+43)+'" cy="'+(y+2)+'" rx="48" ry="10" fill="#49392c" opacity=".15"/>';
  // Shoes and legs are layered behind the clothing.
  if(c.sitting){
    out += line(x+29,y-55,x+63,y-37,pants,20)+line(x+63,y-37,x+70,y-12,pants,18);
    out += line(x+70,y-12,x+84,y-9,"#47352f",13)+line(x+57,y-55,x+91,y-38,pants,20)+line(x+91,y-38,x+99,y-12,pants,18)+line(x+99,y-12,x+112,y-9,"#47352f",13);
  } else {
    out += '<g transform="translate('+num(x+29)+' '+num(y-55)+') rotate('+num(step*17)+' 0 0)">'+line(0,0,-2,46,pants,19)+line(-2,46,12,49,"#47352f",13)+'<path d="M-5 45 Q4 42 12 48 L16 52 Q7 56 -6 52Z" fill="#faf0dc" stroke="#47352f" stroke-width="2"/></g>';
    out += '<g transform="translate('+num(x+59)+' '+num(y-55)+') rotate('+num(-step*17)+' 0 0)">'+line(0,0,2,46,pants,19)+line(2,46,16,49,"#47352f",13)+'<path d="M-1 45 Q9 42 16 48 L20 52 Q10 56 -2 52Z" fill="#faf0dc" stroke="#47352f" stroke-width="2"/></g>';
  }
  // Neck and softly tailored shirt.
  out += '<path d="M'+(hx-10)+' '+(hy+26)+' L'+(hx+10)+' '+(hy+26)+' L'+(hx+10)+' '+(y-124)+' L'+(hx-10)+' '+(y-124)+'Z" fill="'+skin+'" stroke="#573d32" stroke-width="1.8"/>';
  out += path('M'+(x+12)+' '+(y-126)+' Q'+(x+22)+' '+(y-140)+' '+(x+39)+' '+(y-135)+' L'+(x+48)+' '+(y-135)+' Q'+(x+67)+' '+(y-140)+' '+(x+77)+' '+(y-126)+' L'+(x+82)+' '+(y-60)+' Q'+(x+43)+' '+(y-46)+' '+(x+5)+' '+(y-60)+'Z',shirt,"#293e59",2.4);
  out += path('M'+(x+27)+' '+(y-134)+' L'+(x+42)+' '+(y-119)+' L'+(x+34)+' '+(y-106)+' L'+(x+20)+' '+(y-128)+'Z',"#fff0dc","#293e59",1.5);
  out += path('M'+(x+57)+' '+(y-134)+' L'+(x+42)+' '+(y-119)+' L'+(x+50)+' '+(y-106)+' L'+(x+64)+' '+(y-128)+'Z',"#fff0dc","#293e59",1.5);
  out += line(x+42,y-106,x+42,y-62,"#ffffff",2,"opacity='.24'");
  out += '<circle cx="'+(x+42)+'" cy="'+(y-99)+'" r="2" fill="#f4d7a1"/><circle cx="'+(x+42)+'" cy="'+(y-85)+'" r="2" fill="#f4d7a1"/>';
  // Left sleeve, forearm and hand; wave has its own animated pose.
  out += path('M'+(x+15)+' '+(y-119)+' Q'+(x+4)+' '+(y-116)+' '+(x+7)+' '+(y-101)+' L'+(x+13)+' '+(y-92)+' L'+(x+24)+' '+(y-101)+'Z',shirt,"#293e59",2);
  out += line(x+13,y-101,leftWave?x-7:lx,leftWave?y-153:ly,skin,12);
  if(leftWave) out += line(x-7,y-153,x-25+Math.sin(c.wavePhase)*7,y-176,skin,11);
  out += '<circle cx="'+num(lx)+'" cy="'+num(ly)+'" r="7" fill="'+skin+'" stroke="#573d32" stroke-width="1.5"/>';
  // Right arm is driven by the engine's IK solver for pick/give gestures.
  out += path('M'+(x+72)+' '+(y-120)+' Q'+(x+86)+' '+(y-117)+' '+(x+82)+' '+(y-103)+' L'+(x+76)+' '+(y-94)+' L'+(x+65)+' '+(y-102)+'Z',shirt,"#293e59",2);
  out += line(x+75,y-103,el.x,el.y,skin,12)+line(el.x,el.y,hand.x,hand.y,skin,11);
  out += '<circle cx="'+num(hand.x)+'" cy="'+num(hand.y)+'" r="7" fill="'+skin+'" stroke="#573d32" stroke-width="1.5"/>';
  // Head, hair highlights and a tiny collar shadow finish the illustrated silhouette.
  out += '<path d="M'+(hx-19)+' '+(hy-31)+' Q'+(hx-2)+' '+(hy-47)+' '+(hx+17)+' '+(hy-31)+'" fill="none" stroke="#ffffff" stroke-width="2" opacity=".15"/>';
  out += drawFace(c,hx,hy+bob,skin,hair);
  out += '</g>';
  return out;
}
