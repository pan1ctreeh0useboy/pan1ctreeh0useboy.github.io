const priorityWeights = {1: 1.55, 2: 1, 3: 0.66};
const minimumAreaLead = 1.12;

function candidateLayouts(items) {
  const ranges = new Map();

  function layoutsFor(start, end) {
    if (end - start === 1) {
      const {ratio, priority} = items[start].format;
      return [{ratio, weight: priorityWeights[priority], index: start}];
    }
    const key = start + ":" + end;
    if (ranges.has(key)) return ranges.get(key);

    const layouts = [];
    for (let cut = start + 1; cut < end; cut++) {
      for (const first of layoutsFor(start, cut)) {
        for (const second of layoutsFor(cut, end)) {
          const shared = {first, second, weight: first.weight + second.weight};
          layouts.push({...shared, axis: "columns", ratio: first.ratio + second.ratio});
          layouts.push({...shared, axis: "rows", ratio: 1 / (1 / first.ratio + 1 / second.ratio)});
        }
      }
    }
    ranges.set(key, layouts);
    return layouts;
  }

  return layoutsFor(0, items.length);
}

function splitOf(node, blend) {
  const proportion = node.axis === "columns" ? node.first.ratio / node.ratio : node.ratio / node.first.ratio;
  return proportion + blend * (node.first.weight / node.weight - proportion);
}

function place(node, x, y, width, height, rectangles, blend) {
  if (!node.axis) {
    rectangles[node.index] = {x, y, width, height};
    return;
  }
  const split = splitOf(node, blend);
  if (node.axis === "columns") {
    const firstWidth = width * split;
    place(node.first, x, y, firstWidth, height, rectangles, blend);
    place(node.second, x + firstWidth, y, width - firstWidth, height, rectangles, blend);
    return;
  }
  const firstHeight = height * split;
  place(node.first, x, y, width, firstHeight, rectangles, blend);
  place(node.second, x, y + firstHeight, width, height - firstHeight, rectangles, blend);
}

function layoutAt(tree, items, blend) {
  const rectangles = [];
  place(tree, 0, 0, 1, 1, rectangles, blend);
  // A common height that minimizes the weighted squared log-ratio error.
  const logHeight = rectangles.reduce((sum, {width, height}, index) => {
    const {ratio, priority} = items[index].format;
    return sum + priorityWeights[priority] * Math.log(width / height / ratio);
  }, 0) / tree.weight;
  const height = Math.exp(logHeight);
  for (const rectangle of rectangles) {
    rectangle.y *= height;
    rectangle.height *= height;
  }
  return {tree, blend, rectangles, height};
}

function layoutScore(layout, shares, isCompact) {
  const {tree, blend, rectangles, height} = layout;
  const idealRatio = isCompact ? 0.94 : 1.64;
  const minimumWidth = isCompact ? 0.27 : 0.17;
  const minimumHeight = isCompact ? 0.21 : 0.11;
  const idealLargestShare = Math.min(0.63, 1.9 / rectangles.length);
  let score = 0.56 * Math.abs(Math.log(height * idealRatio));
  score += 0.48 * Math.abs(Math.max(...shares) - idealLargestShare);
  for (const {width, height: tileHeight} of rectangles) {
    score += (Math.max(0, 1 - width / minimumWidth) ** 2) * 2.8;
    score += (Math.max(0, 1 - tileHeight / minimumHeight) ** 2) * 2.8;
  }

  if (tree.axis) {
    const split = splitOf(tree, blend);
    score += Math.max(0, 0.19 - Math.min(split, 1 - split));
    if (tree.first.axis && tree.first.axis !== tree.axis) score -= 0.07;
    if (tree.second.axis && tree.second.axis !== tree.axis) score -= 0.07;
  }
  return score;
}

const guideEpsilon = 0.000001;
const guideDistance = 0.037;
const maxContainerRatioChange = Math.log(1.08);

export function dividers(rectangles, axis, axisLimit) {
  const lines = new Map();
  for (const {x, y, width, height} of rectangles) {
    const [start, length, from, to] = axis === "x"
      ? [x, width, y, y + height]
      : [y, height, x, x + width];
    for (const position of [start, start + length]) {
      if (position < guideEpsilon || position > axisLimit - guideEpsilon) continue;
      const key = position.toFixed(7);
      if (!lines.has(key)) lines.set(key, {position, spans: []});
      lines.get(key).spans.push({from, to});
    }
  }
  return Array.from(lines.values()).sort((a, b) => a.position - b.position);
}

function nearlyAligned(rectangles, height, entranceGuides) {
  const corrections = [];
  for (const axis of ["x", "y"]) {
    const limit = axis === "x" ? 1 : height;
    const lines = dividers(rectangles, axis, limit);
    for (const [index, line] of lines.entries()) {
      const next = lines[index + 1];
      if (next && next.position - line.position < guideDistance) {
        const touches = line.spans.some(a => next.spans.some(b =>
          Math.abs(a.to - b.from) < guideEpsilon || Math.abs(b.to - a.from) < guideEpsilon));
        if (touches) {
          corrections.push({
            axis,
            from: [line.position, next.position],
            target: (line.position + next.position) / 2,
            offset: next.position - line.position,
            weight: 0.19,
          });
        }
      }

      if (axis !== "x" || !line.spans.some(span => span.from < guideEpsilon)) continue;
      const previous = lines[index - 1]?.position ?? 0;
      const upper = next?.position ?? limit;
      const aligned = entranceGuides.reduce((nearest, guide) =>
        Math.abs(guide - line.position) < Math.abs(nearest - line.position) ? guide : nearest, Infinity);
      const offset = Math.abs(aligned - line.position);
      if (offset > guideEpsilon && offset < guideDistance && aligned > previous && aligned < upper) {
        corrections.push({axis, from: [line.position], target: aligned, offset, weight: 0.12});
      }
    }
  }
  return corrections;
}

function applyCorrection(rectangles, correction) {
  const move = (position) => correction.from.some(guide => Math.abs(guide - position) < guideEpsilon)
    ? correction.target
    : position;
  return rectangles.map(rectangle => {
    const {x, y, width, height} = rectangle;
    if (correction.axis === "x") {
      const start = move(x);
      return {...rectangle, x: start, width: move(x + width) - start};
    }
    const start = move(y);
    return {...rectangle, y: start, height: move(y + height) - start};
  });
}

function assessLayout(layout, items, isCompact, entranceGuides, areaWeights) {
  const {tree, rectangles, height} = layout;
  const smallest = [0, Infinity, Infinity, Infinity];
  const largest = [0, 0, 0, 0];
  const smallestArtwork = [0, Infinity, Infinity, Infinity];
  const largestArtwork = [0, 0, 0, 0];
  const shares = [];
  let ratioPenalty = 0;
  let largestRatioError = 0;
  let areaPenalty = 0;

  for (const [index, {width, height: tileHeight}] of rectangles.entries()) {
    if (width < guideEpsilon || tileHeight < guideEpsilon) return null;

    const {priority, ratio} = items[index].format;
    const share = width * tileHeight / height;
    shares.push(share);
    smallest[priority] = Math.min(smallest[priority], share);
    largest[priority] = Math.max(largest[priority], share);

    const ratioError = Math.abs(Math.log(width / tileHeight / ratio));
    ratioPenalty += priorityWeights[priority] * ratioError ** 2;
    largestRatioError = Math.max(largestRatioError, ratioError);

    // Equal-ratio media fits this fraction of its container before the common inset.
    const artwork = share * Math.exp(-ratioError);
    smallestArtwork[priority] = Math.min(smallestArtwork[priority], artwork);
    largestArtwork[priority] = Math.max(largestArtwork[priority], artwork);

    if (areaWeights) areaPenalty += Math.abs(share - priorityWeights[priority] / tree.weight);
  }

  let artworkPenalty = 0;
  for (const [higher, lower] of [[1, 2], [1, 3], [2, 3]]) {
    if (smallest[higher] + guideEpsilon < minimumAreaLead * largest[lower]) return null;
    artworkPenalty += Math.max(0, largestArtwork[lower] - smallestArtwork[higher]);
  }

  const cost = layoutScore(layout, shares, isCompact)
    + 1.35 * Math.sqrt(ratioPenalty / tree.weight)
    + 0.25 * largestRatioError
    + 0.65 * areaPenalty
    + 1.8 * artworkPenalty;

  const corrections = nearlyAligned(rectangles, height, entranceGuides);
  const alignmentPenalty = corrections.reduce(
    (total, {offset, weight}) => total + weight * (1 - 0.5 * offset / guideDistance), 0);
  return {...layout, cost, corrections, largestRatioError, score: cost + alignmentPenalty};
}

function canMoveDividers(original, adjusted) {
  return adjusted.every(({width, height}, index) => {
    const before = original[index];
    return width > guideEpsilon && height > guideEpsilon
      && Math.abs(Math.log(width * before.height / (height * before.width))) <= maxContainerRatioChange;
  });
}

function bestLayoutInOrder(items, isCompact, entranceGuides) {
  const priorities = new Set(items.map(({format}) => format.priority));
  const mixed = priorities.size > 1;
  const blends = mixed ? [0, 0.25, 0.5, 0.75, 1] : [0];
  const candidates = [];
  for (const tree of candidateLayouts(items)) {
    for (const blend of blends) {
      const layout = assessLayout(layoutAt(tree, items, blend), items, isCompact, entranceGuides, mixed);
      if (layout) candidates.push(layout);
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  const finalists = new Set(candidates.slice(0, 16));
  candidates.sort((a, b) => a.cost - b.cost);
  for (const candidate of candidates.slice(0, 16)) finalists.add(candidate);

  let best;
  for (const candidate of finalists) {
    let refined = candidate;
    for (let pass = 0; pass < 4; pass++) {
      let next = refined;
      for (const correction of refined.corrections) {
        const rectangles = applyCorrection(refined.rectangles, correction);
        if (!canMoveDividers(candidate.rectangles, rectangles)) continue;
        const trial = assessLayout({...refined, rectangles}, items, isCompact, entranceGuides, mixed);
        if (trial && trial.score < next.score) next = trial;
      }
      if (next === refined) break;
      refined = next;
    }
    if (!best || refined.score < best.score) best = refined;
  }
  return best;
}

export function chooseLayout(items, isCompact, entranceGuides = []) {
  let best = bestLayoutInOrder(items, isCompact, entranceGuides);
  if (best.largestRatioError < Math.log(1.5) || items.length < 3) return best;

  const indexes = items.map((_, index) => index);
  const byRatio = (a, b) => items[a].format.ratio - items[b].format.ratio;
  const byPriority = (a, b) => items[a].format.priority - items[b].format.priority || byRatio(a, b);
  const orders = [[...indexes].sort(byPriority), [...indexes].sort(byRatio)];
  const checked = new Set([indexes.join(",")]);
  for (const order of orders) {
    const key = order.join(",");
    if (checked.has(key)) continue;
    checked.add(key);
    const alternate = bestLayoutInOrder(order.map(index => items[index]), isCompact, entranceGuides);
    const score = alternate.score + 0.07;
    if (score < best.score) {
      const rectangles = [];
      order.forEach((index, position) => { rectangles[index] = alternate.rectangles[position]; });
      best = {...alternate, rectangles, score};
    }
  }
  return best;
}

export function chooseBandLayout(cards, isCompact, entranceGuides) {
  let items = cards;
  let layout = chooseLayout(items, isCompact, entranceGuides);
  if (!isCompact) return {items, overflow: [], layout};

  // A third of the gallery is the minimum artwork width for a shared mobile band.
  while (items.length > 1) {
    const tooSmall = layout.rectangles.findLastIndex(({width, height}, index) => {
      const {cover, format} = items[index];
      const ratio = cover ? cover.width / cover.height : format.ratio;
      return Math.min(width, height * ratio) < 1 / 3;
    });
    if (tooSmall < 0) break;
    items = items.filter((_, index) => index !== tooSmall);
    layout = chooseLayout(items, true, entranceGuides);
  }
  const placed = new Set(items);
  return {items, overflow: cards.filter(card => !placed.has(card)), layout};
}
