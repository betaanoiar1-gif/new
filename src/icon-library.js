// KPE reusable vector prop assets. All artwork is local SVG: no network fetches or GPU.
const safe = value => /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value : "#d94841";
const num = value => Number.isFinite(value) ? Number(value.toFixed(2)) : 0;

export function renderPropIcon(prop) {
  const x = num(prop.x), y = num(prop.y), color = safe(prop.color);
  const common = 'stroke="#342f3a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"';
  let art = "";
  switch (prop.type) {
    case "book":
      art = `
        <ellipse cx="1" cy="27" rx="28" ry="7" fill="#252033" opacity=".12"/>
        <path d="M-25 -24 Q-7 -29 0 -20 V23 Q-9 15 -25 20Z" fill="#f8e7c8" ${common}/>
        <path d="M0 -20 Q10 -29 25 -24 V20 Q10 15 0 23Z" fill="#fff3d8" ${common}/>
        <path d="M-25 -24 Q-8 -30 0 -20 Q10 -30 25 -24 L25 12 Q10 8 0 17 Q-9 8 -25 12Z" fill="${color}" ${common}/>
        <path d="M0 -20 V17" stroke="#f8d98c" stroke-width="3"/>
        <path d="M-16 -13 L-5 -15 M-16 -5 L-5 -7 M7 -13 L17 -15 M7 -5 L17 -7" stroke="#fff0c4" stroke-width="2.5" opacity=".9"/>
        <path d="M13 -24 V-8 L18 -12 L23 -8 V-24" fill="#f5cf74" stroke="#342f3a" stroke-width="1.5"/>
      `;
      break;
    case "ball":
      art = `
        <ellipse cx="0" cy="22" rx="24" ry="6" fill="#252033" opacity=".13"/>
        <circle r="22" fill="${color}" ${common}/>
        <path d="M-18 -10 Q-4 -22 8 -13 Q18 -5 13 8 Q5 19 -9 14 Q-20 8 -18 -10Z" fill="#fff" opacity=".16"/>
        <path d="M-19 -8 Q-4 -3 0 10 Q5 16 14 15 M-5 -21 Q-2 -6 -14 3 M12 -18 Q5 -5 20 4" fill="none" stroke="#fff" stroke-width="2.2" opacity=".7"/>
        <circle cx="-8" cy="-11" r="3.5" fill="#fff" opacity=".65"/>
      `;
      break;
    case "cup":
      art = `
        <ellipse cx="0" cy="23" rx="24" ry="6" fill="#252033" opacity=".12"/>
        <path d="M15 -12 H23 Q34 -12 31 0 Q29 9 16 7" fill="none" stroke="#342f3a" stroke-width="6"/>
        <path d="M15 -12 H23 Q34 -12 31 0 Q29 9 16 7" fill="none" stroke="${color}" stroke-width="3.5"/>
        <path d="M-19 -16 H18 L14 15 Q0 24 -15 15Z" fill="${color}" ${common}/>
        <ellipse cx="-.5" cy="-16" rx="18.5" ry="6" fill="#fff0d9" ${common}/>
        <ellipse cx="-.5" cy="-16" rx="13.5" ry="3.4" fill="#6d4c43"/>
        <path d="M-11 -5 L-8 9" stroke="#fff" stroke-width="3" opacity=".5"/>
      `;
      break;
    case "chair":
      art = `
        <ellipse cx="0" cy="28" rx="27" ry="6" fill="#252033" opacity=".12"/>
        <path d="M-20 -25 H19 Q23 -25 23 -20 V-1 H-23 V-21 Q-23 -25 -20 -25Z" fill="${color}" ${common}/>
        <path d="M-25 -2 H25 Q29 -2 27 5 L22 13 H-20 L-27 5Z" fill="${color}" ${common}/>
        <path d="M-18 13 L-21 27 M19 13 L22 27" fill="none" stroke="#68452e" stroke-width="6"/>
        <path d="M-19 -20 V-5 M-9 -20 V-5 M1 -20 V-5 M11 -20 V-5" stroke="#fff" stroke-width="2" opacity=".25"/>
      `;
      break;
    case "box":
    default:
      art = `
        <ellipse cx="0" cy="25" rx="25" ry="6" fill="#252033" opacity=".12"/>
        <path d="M-23 -13 L0 -25 L24 -13 L0 0Z" fill="#fff" opacity=".25" ${common}/>
        <path d="M-23 -13 L0 0 V24 L-23 11Z" fill="${color}" ${common}/>
        <path d="M0 0 L24 -13 V11 L0 24Z" fill="${color}" ${common}/>
        <path d="M0 0 V24 M-23 -13 L0 0 L24 -13" fill="none" stroke="#342f3a" stroke-width="2.5"/>
        <path d="M-9 -18 L14 -7" stroke="#fff" stroke-width="2" opacity=".55"/>
      `;
      break;
  }
  return '<g transform="translate(' + x + ' ' + y + ')" aria-label="' + String(prop.type).replace(/[^a-z]/gi, "") + '">' + art + '</g>';
}
