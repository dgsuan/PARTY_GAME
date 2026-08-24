// Single source of truth for colour + canvas chrome.
// style.css mirrors these as custom properties; keep the two in sync by
// changing values here first, then the :root block.

export const C = {
  p1: "#22e6c8",
  p1Dim: "rgba(34, 230, 200, 0.28)",
  p2: "#ff4d8d",
  p2Dim: "rgba(255, 77, 141, 0.28)",
  amber: "#ffc247",
  danger: "#ff4d4d",
  ice: "#7fd8ff",
  violet: "#a06bff",
  text: "#e9ecff",
  muted: "#878ec2",
  ink: "#07070d",
};

// Dashed centre divider shared by the three split-screen games.
export function drawDivider(ctx, view, phase = 0) {
  ctx.save();
  const midX = view.width / 2;
  const grad = ctx.createLinearGradient(midX, 0, midX, view.height);
  grad.addColorStop(0, "rgba(255,255,255,0.02)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.30)");
  grad.addColorStop(1, "rgba(255,255,255,0.02)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([14, 12]);
  ctx.lineDashOffset = -phase * 20;
  ctx.beginPath();
  ctx.moveTo(midX, 0);
  ctx.lineTo(midX, view.height);
  ctx.stroke();
  ctx.restore();
}

// Corner brackets framing a half of the viewport — the recurring motif that
// ties the canvas art back to the HTML chrome.
export function drawBrackets(ctx, x, y, w, h, color, len = 22, alpha = 0.5) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "square";
  const corners = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * len, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * len);
    ctx.stroke();
  }
  ctx.restore();
}
