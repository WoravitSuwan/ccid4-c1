/** Clipboard (with legacy fallback) and tactical alert tone (WebAudio, no assets). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

let ctx: AudioContext | null = null;
export function playAlertTone(severity: 'info' | 'warning' | 'critical' = 'critical') {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const tones = severity === 'critical' ? [880, 660, 880, 660] : severity === 'warning' ? [740, 560] : [620];
    const t0 = ctx.currentTime + 0.02;
    tones.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'square';
      osc.frequency.value = f;
      const s = t0 + i * 0.16;
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.exponentialRampToValueAtTime(0.07, s + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.13);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(s);
      osc.stop(s + 0.14);
    });
  } catch {
    /* audio is best-effort */
  }
}
