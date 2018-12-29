/**
 * @typedef {Map<string, {
 *   name:string,
 *   parentNames:!Set<string>,
 *   sources: !Array<{path: string, source: string: sourceMap: string}>,
 *   outputWrapper: (string|undefined)
 * }>}
 */
var ChunkMap;

/**
 * Find an ancestor of a chunk. Return the distance from the target or -1 if not found.
 *
 * @param {!ChunkMap} chunkDefMap
 * @param {string} chunkName
 * @param {string} targetName
 * @param {number} currentDistance
 * @return {number} distance from target of parent or -1 when not found
 */
function findAncestorDistance(
  chunkDefMap,
  chunkName,
  targetName,
  currentDistance
) {
  if (targetName === chunkName) {
    return currentDistance;
  }

  const chunkDef = chunkDefMap.get(chunkName);
  if (!chunkDef) {
    return -1;
  }

  const distances = [];
  chunkDef.parentNames.forEach((parentName) => {
    const distance = findAncestorDistance(
      chunkDefMap,
      parentName,
      targetName,
      currentDistance + 1
    );
    if (distance >= 0) {
      distances.push(distance);
    }
  });
  if (distances.length === 0) {
    return -1;
  }
  return Math.min(...distances);
}

/**
 * Find the closest common parent chunk from a list.
 * Since closure-compiler requires a chunk tree to have a single root,
 * there will always be a common parent.
 *
 * @param {!ChunkMap} chunkDefMap
 * @param {!Array<string>} chunkNames
 * @param {number} currentDistance
 * @return {{name: (string|undefined), distance: number}}
 */
function findNearestCommonParentChunk(
  chunkDefMap,
  chunkNames,
  currentDistance = 0
) {
  // Map of chunk name to distance from target
  const distances = new Map();
  for (let i = 1; i < chunkNames.length; i++) {
    const distance = findAncestorDistance(
      chunkDefMap,
      chunkNames[i],
      chunkNames[0],
      currentDistance
    );
    if (distance < 0) {
      distances.delete(chunkNames[0]);
    } else if (
      !distances.has(chunkNames[0]) ||
      distance < distances.get(chunkNames[0])
    ) {
      distances.set(chunkNames[0], distance);
    }
  }
  if (distances.size === 0) {
    const chunkDef = chunkDefMap.get(chunkNames[0]);
    if (!chunkDef) {
      return {
        name: undefined,
        distance: -1,
      };
    }
    chunkDef.parentNames.forEach((chunkParentName) => {
      const distanceRecord = findNearestCommonParentChunk(
        chunkDefMap,
        [chunkParentName].concat(chunkNames.slice(1)),
        currentDistance + 1
      );
      if (
        distanceRecord.distance >= 0 &&
        (!distances.has(distanceRecord.name) ||
          distances.get(distanceRecord.name) < distanceRecord.distance)
      ) {
        distances.set(distanceRecord.name, distanceRecord.distance);
      }
    });
  }

  const nearestCommonParent = {
    name: undefined,
    distance: -1,
  };
  distances.forEach((distance, chunkName) => {
    if (
      nearestCommonParent.distance < 0 ||
      distance < nearestCommonParent.distance
    ) {
      nearestCommonParent.name = chunkName;
      nearestCommonParent.distance = distance;
    }
  });
  return nearestCommonParent;
}

module.exports = findNearestCommonParentChunk;
