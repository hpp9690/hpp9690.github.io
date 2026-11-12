(() => {
  const movingAverages = [
    { days: 5, color: "#075dab" },
    { days: 10, color: "#a65b12" },
    { days: 20, color: "#7443a6" }
  ];
  let chartObserver;

  function parseBars(lines) {
    const byDate = new Map();
    if (!Array.isArray(lines)) return [];
    for (const line of lines) {
      if (typeof line !== "string") continue;
      const [date, open, close, high, low, volume] = line.split(",");
      const bar = { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          ![bar.open, bar.close, bar.high, bar.low].every((value) => Number.isFinite(value) && value > 0) ||
          bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) ||
          !Number.isFinite(bar.volume) || bar.volume < 0) continue;
      byDate.set(date, bar);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-120);
  }

  function averageSeries(bars, days) {
    let total = 0;
    return bars.map((bar, i) => {
      total += bar.close;
      if (i >= days) total -= bars[i - days].close;
      return i >= days - 1 ? total / days : null;
    });
  }

  function rsi(bars, days = 14) {
    if (bars.length <= days) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i < bars.length; i++) {
      const change = bars[i].close - bars[i - 1].close;
      const up = Math.max(0, change), down = Math.max(0, -change);
      if (i <= days) {
        gain += up / days;
        loss += down / days;
      } else {
        gain = (gain * (days - 1) + up) / days;
        loss = (loss * (days - 1) + down) / days;
      }
    }
    return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  }

  const number = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
  const price = (value) => Number.isFinite(value) ? value.toFixed(2) : "—";

  function clear() {
    chartObserver?.disconnect();
    chartObserver = null;
  }

  function render(section, lines) {
    clear();
    section.removeAttribute("aria-busy");
    const bars = parseBars(lines);
    if (!bars.length) {
      section.innerHTML = '<h4>技术面</h4><p class="muted">日 K 线暂不可用，刷新个股可重试。</p>';
      return;
    }
    const series = movingAverages.map((item) => ({ ...item, values: averageSeries(bars, item.days) }));
    const latest = bars.at(-1), relative = rsi(bars), last20 = bars.slice(-20);
    const priorVolume = bars.length >= 6 ? bars.slice(-6, -1).reduce((sum, bar) => sum + bar.volume, 0) / 5 : 0;
    section.innerHTML = `
      <div class="technical-head"><div><h4>技术面</h4><small>前复权日 K · ${bars.length} 根 · 截至 ${latest.date}</small></div>
        <div class="tabs technical-period" role="group" aria-label="K线显示范围">
          <button type="button" data-days="30" aria-pressed="false">30 日</button>
          <button type="button" data-days="60" aria-pressed="true" class="active">60 日</button>
          <button type="button" data-days="120" aria-pressed="false">120 日</button>
        </div>
      </div>
      <div class="technical-metrics">
        <div><small>RSI 14</small><b data-technical-rsi>${relative === null ? "—" : relative.toFixed(1)}</b></div>
        <div><small>${last20.length} 日价格区间</small><b>${price(Math.min(...last20.map((bar) => bar.low)))} – ${price(Math.max(...last20.map((bar) => bar.high)))}</b></div>
        <div><small>成交量 / 前 5 日均量</small><b>${priorVolume > 0 ? (latest.volume / priorVolume).toFixed(2) + "×" : "—"}</b></div>
      </div>
      <div class="technical-legend">
        ${series.map((item) => `<span style="--ma-color:${item.color}">MA${item.days} <b>${price(item.values.at(-1))}</b></span>`).join("")}
      </div>
      <canvas class="technical-chart" tabindex="0" aria-label="日K线与成交量，按左右方向键查看每天数据" aria-describedby="technicalBar"></canvas>
      <p class="technical-bar" id="technicalBar"></p>
      <p class="flow-note">东方财富日 K 线。最后一根若为当日，会随盘中数据变化。</p>`;
    const canvas = section.querySelector("canvas");
    const selectedLabel = section.querySelector(".technical-bar");
    const context = canvas.getContext("2d");
    let days = 60, selected = bars.length - 1, plot = null;

    function draw() {
      const bar = bars[selected];
      selectedLabel.textContent = `${bar.date}　开 ${price(bar.open)}　高 ${price(bar.high)}　低 ${price(bar.low)}　收 ${price(bar.close)}　量 ${number.format(bar.volume)} 手`;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!context || width < 160 || height < 100) return;
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.scale(scale, scale);
      const start = Math.max(0, bars.length - days), visible = bars.slice(start);
      const left = 8, right = width - 51, top = 9, volumeBase = height - 22;
      const bottom = Math.floor(height * .70), volumeHeight = volumeBase - bottom - 8;
      const step = (right - left) / visible.length, x = (index) => left + (index + .5) * step;
      const values = visible.flatMap((bar) => [bar.low, bar.high]);
      for (const item of series) values.push(...item.values.slice(start).filter(Number.isFinite));
      const low = Math.min(...values), high = Math.max(...values);
      const padding = Math.max((high - low) * .05, high * .002);
      const y = (value) => bottom - (value - low + padding) / (high - low + 2 * padding) * (bottom - top);
      const maxVolume = Math.max(1, ...visible.map((bar) => bar.volume));
      plot = { start, step, left };

      context.font = "11px sans-serif";
      for (let tick = 0; tick <= 4; tick++) {
        const position = top + (bottom - top) * tick / 4;
        context.strokeStyle = "#e3e8ee";
        context.beginPath();
        context.moveTo(left, position);
        context.lineTo(right, position);
        context.stroke();
        context.fillStyle = "#526071";
        const value = high + padding - (high - low + 2 * padding) * tick / 4;
        context.fillText(price(value), right + 5, position + 4);
      }
      visible.forEach((bar, i) => {
        const center = x(i), color = bar.close >= bar.open ? "#b42335" : "#08744f";
        const bodyWidth = Math.max(1, Math.min(14, step * .65));
        context.strokeStyle = color;
        context.beginPath();
        context.moveTo(center, y(bar.high));
        context.lineTo(center, y(bar.low));
        context.stroke();
        context.fillStyle = color;
        context.fillRect(center - bodyWidth / 2, Math.min(y(bar.open), y(bar.close)), bodyWidth, Math.max(1, Math.abs(y(bar.open) - y(bar.close))));
        const volume = bar.volume / maxVolume * volumeHeight;
        context.globalAlpha = .55;
        context.fillRect(center - bodyWidth / 2, volumeBase - volume, bodyWidth, volume);
        context.globalAlpha = 1;
      });
      for (const item of series) {
        context.strokeStyle = item.color;
        context.lineWidth = 1.3;
        context.beginPath();
        let drawn = false;
        item.values.slice(start).forEach((value, index) => {
          if (value === null) return;
          if (drawn) context.lineTo(x(index), y(value));
          else context.moveTo(x(index), y(value));
          drawn = true;
        });
        context.stroke();
      }
      const cursor = x(selected - start);
      context.strokeStyle = "#6b7788";
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(cursor, top);
      context.lineTo(cursor, volumeBase);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#526071";
      context.fillText(visible[0].date, left, height - 5);
      context.textAlign = "right";
      context.fillText(latest.date, right, height - 5);
    }

    function select(index) {
      const first = Math.max(0, bars.length - days);
      const next = Math.max(first, Math.min(bars.length - 1, index));
      if (next === selected) return;
      selected = next;
      draw();
    }

    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch" && plot) select(plot.start + Math.floor((event.offsetX - plot.left) / plot.step));
    });
    canvas.addEventListener("click", (event) => {
      if (plot) select(plot.start + Math.floor((event.offsetX - plot.left) / plot.step));
    });
    canvas.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      select(selected + (event.key === "ArrowLeft" ? -1 : 1));
    });
    section.querySelector(".technical-period").addEventListener("click", (event) => {
      const button = event.target.closest("[data-days]");
      if (!button) return;
      days = Number(button.dataset.days);
      selected = bars.length - 1;
      section.querySelectorAll("[data-days]").forEach((choice) => {
        choice.classList.toggle("active", choice === button);
        choice.setAttribute("aria-pressed", String(choice === button));
      });
      draw();
    });
    chartObserver = new ResizeObserver(draw);
    chartObserver.observe(canvas);
    draw();
  }
  window.QuantTechnical = { render, clear };
})();


