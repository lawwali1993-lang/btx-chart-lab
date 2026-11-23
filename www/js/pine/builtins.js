// Built-in indicator library, written in Pine Script (editable by the user).
export const BUILTIN_SCRIPTS = [
  // ------------------------------------------------------------ moving averages
  { id: 'sma', cat: 'المتوسطات', name: 'Moving Average Simple (SMA)', src: `//@version=5
indicator("SMA", overlay = true)
len = input.int(20, "Length", minval = 1)
src = input.source(close, "Source")
off = input.int(0, "Offset")
plot(ta.sma(src, len), "SMA", color = #2962FF, offset = off)` },
  { id: 'ema', cat: 'المتوسطات', name: 'Moving Average Exponential (EMA)', src: `//@version=5
indicator("EMA", overlay = true)
len = input.int(50, "Length", minval = 1)
src = input.source(close, "Source")
plot(ta.ema(src, len), "EMA", color = #FF9800, linewidth = 2)` },
  { id: 'wma', cat: 'المتوسطات', name: 'Moving Average Weighted (WMA)', src: `//@version=5
indicator("WMA", overlay = true)
len = input.int(20, "Length", minval = 1)
src = input.source(close, "Source")
plot(ta.wma(src, len), "WMA", color = #00BCD4)` },
  { id: 'hma', cat: 'المتوسطات', name: 'Hull Moving Average (HMA)', src: `//@version=5
indicator("Hull MA", overlay = true)
len = input.int(55, "Length", minval = 2)
src = input.source(close, "Source")
h = ta.hma(src, len)
plot(h, "HMA", color = h > h[1] ? color.lime : color.red, linewidth = 2)` },
  { id: 'vwma', cat: 'المتوسطات', name: 'Volume Weighted MA (VWMA)', src: `//@version=5
indicator("VWMA", overlay = true)
len = input.int(20, "Length", minval = 1)
plot(ta.vwma(close, len), "VWMA", color = #E040FB)` },
  { id: 'ribbon', cat: 'المتوسطات', name: 'EMA Ribbon 8/21/50/200', src: `//@version=5
indicator("EMA Ribbon", overlay = true)
e1 = ta.ema(close, input.int(8, "EMA 1"))
e2 = ta.ema(close, input.int(21, "EMA 2"))
e3 = ta.ema(close, input.int(50, "EMA 3"))
e4 = ta.ema(close, input.int(200, "EMA 4"))
p1 = plot(e1, "EMA 8", color = #00E676)
p2 = plot(e2, "EMA 21", color = #FFEB3B)
plot(e3, "EMA 50", color = #FF9800, linewidth = 2)
plot(e4, "EMA 200", color = #F23645, linewidth = 2)
fill(p1, p2, color = e1 > e2 ? color.new(color.green, 85) : color.new(color.red, 85))` },
  { id: 'alma', cat: 'المتوسطات', name: 'Arnaud Legoux MA (ALMA)', src: `//@version=5
indicator("ALMA", overlay = true)
len = input.int(9, "Window Size")
off = input.float(0.85, "Offset")
sig = input.float(6, "Sigma")
plot(ta.alma(close, len, off, sig), "ALMA", color = #26A69A, linewidth = 2)` },
  // ------------------------------------------------------------ bands & channels
  { id: 'bb', cat: 'القنوات والنطاقات', name: 'Bollinger Bands', src: `//@version=5
indicator("Bollinger Bands", shorttitle = "BB", overlay = true)
length = input.int(20, "Length", minval = 1)
src = input.source(close, "Source")
mult = input.float(2.0, "StdDev", minval = 0.001, maxval = 50)
[basis, upper, lower] = ta.bb(src, length, mult)
plot(basis, "Basis", color = #FF6D00)
p1 = plot(upper, "Upper", color = #2962FF)
p2 = plot(lower, "Lower", color = #2962FF)
fill(p1, p2, title = "Background", color = color.rgb(33, 150, 243, 95))` },
  { id: 'kc', cat: 'القنوات والنطاقات', name: 'Keltner Channels', src: `//@version=5
indicator("Keltner Channels", shorttitle = "KC", overlay = true)
length = input.int(20, "Length")
mult = input.float(2.0, "Multiplier")
[m, u, l] = ta.kc(close, length, mult)
plot(m, "Basis", color = #2962FF)
u1 = plot(u, "Upper", color = #2962FF)
l1 = plot(l, "Lower", color = #2962FF)
fill(u1, l1, color = color.rgb(33, 150, 243, 95))` },
  { id: 'dc', cat: 'القنوات والنطاقات', name: 'Donchian Channels', src: `//@version=5
indicator("Donchian Channels", shorttitle = "DC", overlay = true)
length = input.int(20, "Length", minval = 1)
lower = ta.lowest(length)
upper = ta.highest(length)
basis = math.avg(upper, lower)
plot(basis, "Basis", color = #FF6D00)
u = plot(upper, "Upper", color = #2962FF)
l = plot(lower, "Lower", color = #2962FF)
fill(u, l, color = color.rgb(33, 150, 243, 95))` },
  { id: 'linreg', cat: 'القنوات والنطاقات', name: 'Linear Regression Channel', src: `//@version=5
indicator("Linear Regression Channel", overlay = true)
len = input.int(100, "Length", minval = 2)
dev = input.float(2.0, "Deviation")
var line mid = na
var line up = na
var line dn = na
if barstate.islast
    float sx = 0.0, float sy = 0.0, float sxy = 0.0, float sxx = 0.0
    for i = 0 to len - 1
        x = len - 1 - i
        sx += x
        sy += close[i]
        sxy += x * close[i]
        sxx += x * x
    slope = (len * sxy - sx * sy) / (len * sxx - sx * sx)
    icpt = (sy - slope * sx) / len
    float se = 0.0
    for i = 0 to len - 1
        x = len - 1 - i
        se += math.pow(close[i] - (icpt + slope * x), 2)
    sd = math.sqrt(se / len)
    y1 = icpt
    y2 = icpt + slope * (len - 1)
    line.delete(mid), line.delete(up), line.delete(dn)
    mid := line.new(bar_index - len + 1, y1, bar_index, y2, color = color.orange, width = 2, extend = extend.right)
    up := line.new(bar_index - len + 1, y1 + dev * sd, bar_index, y2 + dev * sd, color = color.teal, extend = extend.right)
    dn := line.new(bar_index - len + 1, y1 - dev * sd, bar_index, y2 - dev * sd, color = color.red, extend = extend.right)` },
  // ------------------------------------------------------------ oscillators
  { id: 'rsi', cat: 'المذبذبات', name: 'Relative Strength Index (RSI)', src: `//@version=5
indicator("Relative Strength Index", shorttitle = "RSI", format = format.price, precision = 2)
len = input.int(14, "RSI Length", minval = 1)
src = input.source(close, "Source")
maLen = input.int(14, "MA Length")
r = ta.rsi(src, len)
plot(r, "RSI", color = #7E57C2)
plot(ta.sma(r, maLen), "RSI-based MA", color = color.yellow)
h1 = hline(70, "Upper Band", color = #787B86)
hline(50, "Middle Band", color = color.new(#787B86, 50))
h0 = hline(30, "Lower Band", color = #787B86)
fill(h1, h0, color = color.rgb(126, 87, 194, 90), title = "Background")` },
  { id: 'macd', cat: 'المذبذبات', name: 'MACD', src: `//@version=5
indicator("MACD", format = format.price, precision = 4)
fast = input.int(12, "Fast Length")
slow = input.int(26, "Slow Length")
sigLen = input.int(9, "Signal Smoothing", minval = 1, maxval = 50)
src = input.source(close, "Source")
[m, s, h] = ta.macd(src, fast, slow, sigLen)
plot(h, "Histogram", style = plot.style_columns, color = (h >= 0 ? (h[1] < h ? #26A69A : #B2DFDB) : (h[1] < h ? #FFCDD2 : #FF5252)))
plot(m, "MACD", color = #2962FF)
plot(s, "Signal", color = #FF6D00)
hline(0, "Zero", color = color.new(#787B86, 50))` },
  { id: 'stoch', cat: 'المذبذبات', name: 'Stochastic', src: `//@version=5
indicator("Stochastic", shorttitle = "Stoch", format = format.price, precision = 2)
periodK = input.int(14, "%K Length", minval = 1)
smoothK = input.int(1, "%K Smoothing", minval = 1)
periodD = input.int(3, "%D Smoothing", minval = 1)
k = ta.sma(ta.stoch(close, high, low, periodK), smoothK)
d = ta.sma(k, periodD)
plot(k, "%K", color = #2962FF)
plot(d, "%D", color = #FF6D00)
h0 = hline(80, "Upper Band", color = #787B86)
hline(50, "Middle Band", color = color.new(#787B86, 50))
h1 = hline(20, "Lower Band", color = #787B86)
fill(h0, h1, color = color.rgb(33, 150, 243, 90), title = "Background")` },
  { id: 'stochrsi', cat: 'المذبذبات', name: 'Stochastic RSI', src: `//@version=5
indicator("Stochastic RSI", shorttitle = "Stoch RSI")
smoothK = input.int(3, "K", minval = 1)
smoothD = input.int(3, "D", minval = 1)
lengthRSI = input.int(14, "RSI Length", minval = 1)
lengthStoch = input.int(14, "Stochastic Length", minval = 1)
rsi1 = ta.rsi(close, lengthRSI)
k = ta.sma(ta.stoch(rsi1, rsi1, rsi1, lengthStoch), smoothK)
d = ta.sma(k, smoothD)
plot(k, "K", color = #2962FF)
plot(d, "D", color = #FF6D00)
h0 = hline(80, "Upper Band", color = #787B86)
h1 = hline(20, "Lower Band", color = #787B86)
fill(h0, h1, color = color.rgb(33, 150, 243, 90))` },
  { id: 'wpr', cat: 'المذبذبات', name: 'Williams %R', src: `//@version=5
indicator("Williams Percent Range", shorttitle = "Williams %R", format = format.price, precision = 2)
length = input.int(14, "Length", minval = 1)
upper = ta.highest(length)
lower = ta.lowest(length)
out = 100 * (close - upper) / (upper - lower)
plot(out, "%R", color = #7E57C2)
b1 = hline(-20, "Upper Band", color = #787B86)
hline(-50, "Middle Level", color = color.new(#787B86, 50))
b0 = hline(-80, "Lower Band", color = #787B86)
fill(b1, b0, color = color.rgb(126, 87, 194, 90))` },
  { id: 'cci', cat: 'المذبذبات', name: 'Commodity Channel Index (CCI)', src: `//@version=5
indicator("Commodity Channel Index", shorttitle = "CCI")
length = input.int(20, "Length", minval = 1)
src = input.source(hlc3, "Source")
plot(ta.cci(src, length), "CCI", color = #2962FF)
b0 = hline(100, "Upper Band", color = #787B86)
hline(0, "Middle Band", color = color.new(#787B86, 50))
b1 = hline(-100, "Lower Band", color = #787B86)
fill(b0, b1, color = color.rgb(33, 150, 243, 90))` },
  { id: 'mom', cat: 'المذبذبات', name: 'Momentum', src: `//@version=5
indicator("Momentum", shorttitle = "Mom")
len = input.int(10, "Length", minval = 1)
plot(ta.mom(close, len), "MOM", color = #2962FF)
hline(0, "Zero")` },
  { id: 'roc', cat: 'المذبذبات', name: 'Rate Of Change (ROC)', src: `//@version=5
indicator("Rate Of Change", shorttitle = "ROC")
length = input.int(9, "Length", minval = 1)
plot(ta.roc(close, length), "ROC", color = #2962FF)
hline(0, "Zero Line")` },
  { id: 'mfi', cat: 'المذبذبات', name: 'Money Flow Index (MFI)', src: `//@version=5
indicator("Money Flow Index", shorttitle = "MFI")
length = input.int(14, "Length", minval = 1)
plot(ta.mfi(hlc3, length), "MF", color = #7E57C2)
o = hline(80, "Overbought", color = #787B86)
s = hline(20, "Oversold", color = #787B86)
fill(o, s, color = color.rgb(126, 87, 194, 90))` },
  { id: 'ao', cat: 'المذبذبات', name: 'Awesome Oscillator', src: `//@version=5
indicator("Awesome Oscillator", shorttitle = "AO")
ao = ta.sma(hl2, 5) - ta.sma(hl2, 34)
diff = ao - ao[1]
plot(ao, "AO", color = diff <= 0 ? #F44336 : #009688, style = plot.style_columns)` },
  { id: 'dmi', cat: 'المذبذبات', name: 'Directional Movement Index (DMI/ADX)', src: `//@version=5
indicator("Directional Movement Index", shorttitle = "DMI")
len = input.int(14, "DI Length", minval = 1)
lensig = input.int(14, "ADX Smoothing", minval = 1, maxval = 50)
[diplus, diminus, adx] = ta.dmi(len, lensig)
plot(adx, "ADX", color = #F50057)
plot(diplus, "+DI", color = #2962FF)
plot(diminus, "-DI", color = #FF6D00)` },
  { id: 'atr', cat: 'المذبذبات', name: 'Average True Range (ATR)', src: `//@version=5
indicator("Average True Range", shorttitle = "ATR")
length = input.int(14, "Length", minval = 1)
smoothing = input.string("RMA", "Smoothing", options = ["RMA", "SMA", "EMA", "WMA"])
ma(src, len) =>
    switch smoothing
        "RMA" => ta.rma(src, len)
        "SMA" => ta.sma(src, len)
        "EMA" => ta.ema(src, len)
        => ta.wma(src, len)
plot(ma(ta.tr(true), length), "ATR", color = #B71C1C)` },
  // ------------------------------------------------------------ volume
  { id: 'vol', cat: 'الحجم', name: 'Volume + MA', src: `//@version=5
indicator("Volume", format = format.volume)
maLen = input.int(20, "MA Length")
plot(volume, "Volume", style = plot.style_columns, color = close >= open ? color.new(#26A69A, 50) : color.new(#EF5350, 50))
plot(ta.sma(volume, maLen), "Volume MA", color = #2196F3)` },
  { id: 'vwap', cat: 'الحجم', name: 'VWAP + Bands', src: `//@version=5
indicator("VWAP", overlay = true)
src = input.source(hlc3, "Source")
mult = input.float(1.0, "Bands Multiplier")
showBands = input.bool(true, "Show Bands")
anchor = timeframe.change("D")
[v, up, dn] = ta.vwap(src, anchor, mult)
plot(v, "VWAP", color = #2962FF, linewidth = 2)
u = plot(showBands ? up : na, "Upper", color = color.green)
d = plot(showBands ? dn : na, "Lower", color = color.green)
fill(u, d, color = color.new(color.green, 95))` },
  { id: 'obv', cat: 'الحجم', name: 'On Balance Volume (OBV)', src: `//@version=5
indicator("On Balance Volume", shorttitle = "OBV", format = format.volume)
plot(ta.obv, "OBV", color = #2962FF)
plot(ta.ema(ta.obv, input.int(21, "Smoothing")), "Signal", color = color.orange)` },
  { id: 'ad', cat: 'الحجم', name: 'Accumulation/Distribution', src: `//@version=5
indicator("Accumulation/Distribution", shorttitle = "Accum/Dist", format = format.volume)
plot(ta.accdist, "Accumulation/Distribution", color = #999915)` },
  { id: 'vp', cat: 'الحجم', name: 'Volume Profile (Range)', src: `//@version=5
indicator("Volume Profile", shorttitle = "VP", overlay = true, max_boxes_count = 200)
lookback = input.int(300, "Bars", minval = 20, maxval = 5000)
rows = input.int(40, "Rows", minval = 10, maxval = 120)
width = input.int(60, "Width (bars)")
vaPct = input.float(70, "Value Area %")
upCol = input.color(color.new(#2962FF, 55), "Volume")
vaCol = input.color(color.new(#FF9800, 45), "Value Area")
pocCol = input.color(#F23645, "POC")
var boxes = array.new_box()
hi = ta.highest(high, lookback)
lo = ta.lowest(low, lookback)
if barstate.islast
    for b in boxes
        box.delete(b)
    array.clear(boxes)
    step = (hi - lo) / rows
    vols = array.new_float(rows, 0.0)
    for i = 0 to lookback - 1
        tp = hlc3[i]
        idx = math.min(rows - 1, int((tp - lo) / step))
        array.set(vols, idx, array.get(vols, idx) + volume[i])
    maxV = array.max(vols)
    poc = array.indexof(vols, maxV)
    total = array.sum(vols)
    va = array.get(vols, poc)
    lo_i = poc
    hi_i = poc
    while va < total * vaPct / 100 and (lo_i > 0 or hi_i < rows - 1)
        below = lo_i > 0 ? array.get(vols, lo_i - 1) : -1.0
        above = hi_i < rows - 1 ? array.get(vols, hi_i + 1) : -1.0
        if above >= below
            hi_i += 1
            va += above
        else
            lo_i -= 1
            va += below
    for r = 0 to rows - 1
        v = array.get(vols, r)
        w = int(width * v / maxV)
        if w > 0
            c = r == poc ? pocCol : (r >= lo_i and r <= hi_i ? vaCol : upCol)
            array.push(boxes, box.new(bar_index + 2, lo + step * (r + 1), bar_index + 2 + w, lo + step * r, border_color = c, bgcolor = c))
    array.push(boxes, box.new(bar_index - lookback, lo + step * (poc + 0.5), bar_index + 2, lo + step * (poc + 0.5), border_color = pocCol, border_width = 1))` },
  // ------------------------------------------------------------ trend
  { id: 'supertrend', cat: 'الاتجاه', name: 'SuperTrend', src: `//@version=5
indicator("Supertrend", overlay = true)
atrPeriod = input.int(10, "ATR Length", minval = 1)
factor = input.float(3.0, "Factor", minval = 0.01, step = 0.01)
[st, direction] = ta.supertrend(factor, atrPeriod)
st := barstate.isfirst ? na : st
upTrend = plot(direction < 0 ? st : na, "Up Trend", color = color.green, style = plot.style_linebr)
downTrend = plot(direction < 0 ? na : st, "Down Trend", color = color.red, style = plot.style_linebr)
bodyMiddle = plot(barstate.isfirst ? na : (open + close) / 2, "Body Middle", display = display.none)
fill(bodyMiddle, upTrend, color.new(color.green, 90), fillgaps = false)
fill(bodyMiddle, downTrend, color.new(color.red, 90), fillgaps = false)
plotshape(direction < 0 and direction[1] > 0 ? st : na, "Buy", shape.labelup, location.absolute, color.green, text = "Buy", textcolor = color.white, size = size.tiny)
plotshape(direction > 0 and direction[1] < 0 ? st : na, "Sell", shape.labeldown, location.absolute, color.red, text = "Sell", textcolor = color.white, size = size.tiny)` },
  { id: 'psar', cat: 'الاتجاه', name: 'Parabolic SAR', src: `//@version=5
indicator("Parabolic SAR", shorttitle = "SAR", overlay = true)
start = input.float(0.02, "Start")
increment = input.float(0.02, "Increment")
maximum = input.float(0.2, "Max Value")
out = ta.sar(start, increment, maximum)
plot(out, "ParabolicSAR", style = plot.style_cross, color = out > close ? #F23645 : #2962FF)` },
  { id: 'ichimoku', cat: 'الاتجاه', name: 'Ichimoku Cloud', src: `//@version=5
indicator("Ichimoku Cloud", shorttitle = "Ichimoku", overlay = true)
conversionPeriods = input.int(9, "Conversion Line Length")
basePeriods = input.int(26, "Base Line Length")
laggingSpan2Periods = input.int(52, "Leading Span B Length")
displacement = input.int(26, "Lagging Span")
donchian(len) => math.avg(ta.lowest(len), ta.highest(len))
conversionLine = donchian(conversionPeriods)
baseLine = donchian(basePeriods)
leadLine1 = math.avg(conversionLine, baseLine)
leadLine2 = donchian(laggingSpan2Periods)
plot(conversionLine, color = #2962FF, title = "Conversion Line")
plot(baseLine, color = #B71C1C, title = "Base Line")
plot(close, offset = -displacement + 1, color = #43A047, title = "Lagging Span")
p1 = plot(leadLine1, offset = displacement - 1, color = #A5D6A7, title = "Leading Span A")
p2 = plot(leadLine2, offset = displacement - 1, color = #EF9A9A, title = "Leading Span B")
fill(p1, p2, color = leadLine1 > leadLine2 ? color.rgb(67, 160, 71, 90) : color.rgb(244, 67, 54, 90))` },
  { id: 'zigzag', cat: 'الاتجاه', name: 'ZigZag (Pivots)', src: `//@version=5
indicator("ZigZag", overlay = true, max_lines_count = 500, max_labels_count = 500)
dev = input.int(10, "Pivot Legs", minval = 2)
showLabels = input.bool(true, "Show Price Labels")
ph = ta.pivothigh(high, dev, dev)
pl = ta.pivotlow(low, dev, dev)
var float lastP = na
var int lastX = na
var int lastDir = 0
var line lastLine = na
var label lastLbl = na
if not na(ph)
    if lastDir == 1 and ph > lastP
        line.set_xy2(lastLine, bar_index - dev, ph)
        label.set_xy(lastLbl, bar_index - dev, ph)
        label.set_text(lastLbl, str.tostring(ph, format.mintick))
        lastP := ph
        lastX := bar_index - dev
    else if lastDir != 1
        if not na(lastP)
            lastLine := line.new(lastX, lastP, bar_index - dev, ph, color = color.orange, width = 2)
        if showLabels
            lastLbl := label.new(bar_index - dev, ph, str.tostring(ph, format.mintick), style = label.style_label_down, color = color.new(color.red, 30), textcolor = color.white, size = size.small)
        lastP := ph
        lastX := bar_index - dev
        lastDir := 1
if not na(pl)
    if lastDir == -1 and pl < lastP
        line.set_xy2(lastLine, bar_index - dev, pl)
        label.set_xy(lastLbl, bar_index - dev, pl)
        label.set_text(lastLbl, str.tostring(pl, format.mintick))
        lastP := pl
        lastX := bar_index - dev
    else if lastDir != -1
        if not na(lastP)
            lastLine := line.new(lastX, lastP, bar_index - dev, pl, color = color.orange, width = 2)
        if showLabels
            lastLbl := label.new(bar_index - dev, pl, str.tostring(pl, format.mintick), style = label.style_label_up, color = color.new(color.green, 30), textcolor = color.white, size = size.small)
        lastP := pl
        lastX := bar_index - dev
        lastDir := -1` },
  { id: 'pivots', cat: 'الاتجاه', name: 'Pivot Points Standard (Daily)', src: `//@version=5
indicator("Pivot Points Standard", "Pivots", overlay = true)
kind = input.string("Traditional", "Type", options = ["Traditional", "Fibonacci", "Woodie", "Classic", "Camarilla"])
newDay = timeframe.change("D")
levels = ta.pivot_point_levels(kind, newDay)
p = array.get(levels, 0)
plot(p, "P", color = color.orange, style = plot.style_linebr, linewidth = 2)
plot(array.get(levels, 1), "R1", color = color.red, style = plot.style_linebr)
plot(array.get(levels, 2), "S1", color = color.green, style = plot.style_linebr)
plot(array.get(levels, 3), "R2", color = color.red, style = plot.style_linebr)
plot(array.get(levels, 4), "S2", color = color.green, style = plot.style_linebr)
plot(array.get(levels, 5), "R3", color = color.red, style = plot.style_linebr)
plot(array.get(levels, 6), "S3", color = color.green, style = plot.style_linebr)` },
  { id: 'pdhl', cat: 'الاتجاه', name: 'Previous Day High/Low', src: `//@version=5
indicator("Previous Day High Low", "PDH/PDL", overlay = true)
[pdh, pdl, pdc] = request.security(syminfo.tickerid, "D", [high[1], low[1], close[1]], lookahead = barmerge.lookahead_on)
plot(pdh, "PDH", color = color.red, style = plot.style_linebr, linewidth = 2)
plot(pdl, "PDL", color = color.green, style = plot.style_linebr, linewidth = 2)
plot(pdc, "PDC", color = color.gray, style = plot.style_linebr)` },
  { id: 'sessions', cat: 'الاتجاه', name: 'Sessions (Asia / London / New York)', src: `//@version=5
indicator("Sessions", overlay = true, max_boxes_count = 500)
tz = input.string("UTC", "Time Zone")
asia = input.session("0000-0900", "Asia")
london = input.session("0700-1600", "London")
ny = input.session("1200-2100", "New York")
sess(s, col, name) =>
    var box b = na
    var float hi = na
    var float lo = na
    inS = not na(time(timeframe.period, s, tz))
    if inS and not inS[1]
        hi := high
        lo := low
        b := box.new(bar_index, hi, bar_index, lo, border_color = color.new(col, 40), bgcolor = color.new(col, 88), text = name, text_color = color.new(col, 20), text_size = size.small, text_valign = text.align_top)
    if inS
        hi := math.max(hi, high)
        lo := math.min(lo, low)
        box.set_top(b, hi)
        box.set_bottom(b, lo)
        box.set_right(b, bar_index)
    inS
sess(asia, color.purple, "Asia")
sess(london, color.blue, "London")
sess(ny, color.orange, "New York")` },
  // ------------------------------------------------------------ Ali
  { id: 'ali_wr', cat: 'استراتيجيات علي', name: 'Williams %R + RSI Reversal Signals (Ali)', src: `//@version=5
indicator("Ali Williams %R + RSI Reversal", "Ali W%R", overlay = true)
wrLen = input.int(20, "Williams %R Length")
upLvl = input.float(-10, "Overbought level (-1 .. -10)")
dnLvl = input.float(-90, "Oversold level (-90 .. -100)")
useRsi = input.bool(false, "Require RSI filter")
rsiLen = input.int(14, "RSI Length")
rsiOB = input.float(70, "RSI Overbought")
rsiOS = input.float(30, "RSI Oversold")
trendLen = input.int(30, "Trend: break of highs/lows (bars)")
wr = ta.wpr(wrLen)
r = ta.rsi(close, rsiLen)
// trend by break of highs / lows
hh = ta.highest(high, trendLen)[1]
ll = ta.lowest(low, trendLen)[1]
var int trend = 0
if close > hh
    trend := 1
if close < ll
    trend := -1
bullRev = close > open and close[1] < open[1]
bearRev = close < open and close[1] > open[1]
wrLow = ta.lowest(wr, 3) <= dnLvl
wrHigh = ta.highest(wr, 3) >= upLvl
buy = trend == 1 and bullRev and wrLow and (not useRsi or ta.lowest(r, 3) <= rsiOS)
sell = trend == -1 and bearRev and wrHigh and (not useRsi or ta.highest(r, 3) >= rsiOB)
plotshape(buy, "Buy", shape.triangleup, location.belowbar, color.lime, size = size.small, text = "BUY", textcolor = color.lime)
plotshape(sell, "Sell", shape.triangledown, location.abovebar, color.red, size = size.small, text = "SELL", textcolor = color.red)
bgcolor(trend == 1 ? color.new(color.green, 94) : trend == -1 ? color.new(color.red, 94) : na)
alertcondition(buy, "Ali Buy", "Williams %R reversal BUY")
alertcondition(sell, "Ali Sell", "Williams %R reversal SELL")` },
  { id: 'ali_wr_strat', cat: 'استراتيجيات علي', name: 'Ali Basket Strategy (W%R reversal, no SL, $ target)', strategy: true, src: `//@version=5
strategy("Ali Basket W%R", overlay = true, pyramiding = 50, initial_capital = 1000, commission_type = strategy.commission.cash_per_contract, commission_value = 0, process_orders_on_close = true)
lots = input.float(0.01, "Lot size")
contract = input.float(100, "Contract size (gold = 100 oz)")
targetUsd = input.float(1.5, "Close all at basket profit ($)")
maxTrades = input.int(10, "Max trades in basket")
wrLen = input.int(20, "Williams %R Length")
upLvl = input.float(-10, "Overbought level")
dnLvl = input.float(-90, "Oversold level")
trendLen = input.int(30, "Trend lookback (bars)")
wr = ta.wpr(wrLen)
hh = ta.highest(high, trendLen)[1]
ll = ta.lowest(low, trendLen)[1]
var int trend = 0
if close > hh
    trend := 1
if close < ll
    trend := -1
bullRev = close > open and close[1] < open[1]
bearRev = close < open and close[1] > open[1]
buy = trend == 1 and bullRev and ta.lowest(wr, 3) <= dnLvl
sell = trend == -1 and bearRev and ta.highest(wr, 3) >= upLvl
qty = lots * contract
inBasket = strategy.opentrades > 0
if strategy.openprofit >= targetUsd and inBasket
    strategy.close_all(comment = "TP $")
else
    if buy and strategy.position_size >= 0 and strategy.opentrades < maxTrades and (not inBasket or strategy.openprofit < 0)
        strategy.order("B" + str.tostring(strategy.opentrades), strategy.long, qty)
    if sell and strategy.position_size <= 0 and strategy.opentrades < maxTrades and (not inBasket or strategy.openprofit < 0)
        strategy.order("S" + str.tostring(strategy.opentrades), strategy.short, qty)
plot(strategy.position_avg_price, "Avg price", color = color.yellow, style = plot.style_linebr)` },
  // ------------------------------------------------------------ strategies
  { id: 'macross', cat: 'استراتيجيات', name: 'MA Cross Strategy', strategy: true, src: `//@version=5
strategy("MA Cross Strategy", overlay = true, initial_capital = 10000, default_qty_type = strategy.fixed, default_qty_value = 1)
fastLen = input.int(9, "Fast MA")
slowLen = input.int(21, "Slow MA")
tp = input.int(0, "Take profit (ticks, 0 = off)")
sl = input.int(0, "Stop loss (ticks, 0 = off)")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
plot(fast, "Fast", color = color.aqua)
plot(slow, "Slow", color = color.orange)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)
if tp > 0 or sl > 0
    strategy.exit("XL", "Long", profit = tp > 0 ? tp : na, loss = sl > 0 ? sl : na)
    strategy.exit("XS", "Short", profit = tp > 0 ? tp : na, loss = sl > 0 ? sl : na)` },
  { id: 'rsistrat', cat: 'استراتيجيات', name: 'RSI Strategy', strategy: true, src: `//@version=5
strategy("RSI Strategy", overlay = true, initial_capital = 10000)
length = input.int(14, "RSI Length")
overSold = input.int(30, "Oversold")
overBought = input.int(70, "Overbought")
vrsi = ta.rsi(close, length)
co = ta.crossover(vrsi, overSold)
cu = ta.crossunder(vrsi, overBought)
if not na(vrsi)
    if co
        strategy.entry("RsiLE", strategy.long, comment = "RsiLE")
    if cu
        strategy.entry("RsiSE", strategy.short, comment = "RsiSE")` },
  { id: 'ststrat', cat: 'استراتيجيات', name: 'SuperTrend Strategy', strategy: true, src: `//@version=5
strategy("Supertrend Strategy", overlay = true, initial_capital = 10000)
atrPeriod = input.int(10, "ATR Length")
factor = input.float(3.0, "Factor", step = 0.01)
[st, direction] = ta.supertrend(factor, atrPeriod)
plot(direction < 0 ? st : na, "Up", color = color.green, style = plot.style_linebr)
plot(direction > 0 ? st : na, "Down", color = color.red, style = plot.style_linebr)
if ta.change(direction) < 0
    strategy.entry("Long", strategy.long)
if ta.change(direction) > 0
    strategy.entry("Short", strategy.short)` },
];

export const NEW_SCRIPT_TEMPLATE = `//@version=5
indicator("My Script", overlay = true)
length = input.int(20, "Length")
ma = ta.sma(close, length)
plot(ma, "MA", color = color.orange, linewidth = 2)
`;

export const NEW_STRATEGY_TEMPLATE = `//@version=5
strategy("My Strategy", overlay = true, initial_capital = 1000, default_qty_type = strategy.fixed, default_qty_value = 1)
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)
plot(fast, color = color.aqua)
plot(slow, color = color.orange)
`;
