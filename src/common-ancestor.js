/**
 * Find an ancestor of a chunk. Return the distance from the target or -1 if not found.
 *
 * @param {string} src
 * @param {string} target
 * @param {number} currentDistance
 * @return {number} distance from target of parent or -1 when not found
 */
function findAncestorDistance(src, target, currentDistance) {
  if (target === src) {
    return currentDistance;
  }

  const distances = [];
  src.getParents().forEach((srcParentChunkGroup) => {
    const distance = findAncestorDistance(
      srcParentChunkGroup,
      target,
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
 * @param {!Array<string>} chunkGroups
 * @param {number} currentDistance
 * @return {{chunkGroup: (!ChunkGroup|undefined), distance: number}}
 */
function findNearestCommonParentChunk(chunkGroups, currentDistance = 0) {
  // Map of chunk name to distance from target
  const distances = new Map();
  for (let i = 1; i < chunkGroups.length; i++) {
    const distance = findAncestorDistance(
      chunkGroups[i],
      chunkGroups[0],
      currentDistance
    );
    if (distance < 0) {
      distances.delete(chunkGroups[0]);
    } else if (
      !distances.has(chunkGroups[0]) ||
      distance < distances.get(chunkGroups[0])
    ) {
      distances.set(chunkGroups[0], distance);
    }
  }
  if (distances.size === 0) {
    // chunkGroup[0] was not a parent for the other chunk groups.
    // So move up the graph one level and check again.
    chunkGroups[0].getParents().forEach((chunkGroupParent) => {
      const distanceRecord = findNearestCommonParentChunk(
        [chunkGroupParent].concat(chunkGroups.slice(1)),
        currentDistance + 1
      );
      if (
        distanceRecord.distance >= 0 &&
        (!distances.has(distanceRecord.chunkGroup) ||
          distances.get(distanceRecord.chunkGroup) < distanceRecord.distance)
      ) {
        distances.set(distanceRecord.chunkGroup, distanceRecord.distance);
      }
    });
  }

  const nearestCommonParent = {
    chunkGroup: undefined,
    distance: -1,
  };
  distances.forEach((distance, chunkGroup) => {
    if (
      nearestCommonParent.distance < 0 ||
      distance < nearestCommonParent.distance
    ) {
      nearestCommonParent.chunkGroup = chunkGroup;
      nearestCommonParent.distance = distance;
    }
  });
  return nearestCommonParent;
}

module.exports = findNearestCommonParentChunk;
