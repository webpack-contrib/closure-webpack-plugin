/**
 * Helper methods to create Webpack 4 style ChunkGroups from Webpack3 chunks
 */

class Webpack3ChunkGroup {
  constructor(chunks) {
    this.chunks = chunks;
    this.children_ = [];
    this.parents_ = [];
  }

  getChildren() {
    return this.children_;
  }

  getParents() {
    return this.parents_;
  }
}

class Webpack3Entrypoint extends Webpack3ChunkGroup {}

function buildChunkMap(allChunks, startingChunk = null) {
  function isTargetChunk(chunk) {
    if (startingChunk === null) {
      return chunk.parents.length === 0;
    }
    return chunk.parents.includes(startingChunk);
  }

  const chunkMap = new Map();
  allChunks.forEach((chunk) => {
    if (isTargetChunk(chunk)) {
      const childChunksMap = buildChunkMap(allChunks, chunk);

      // The Commons Chunk plugin can create an extra async chunk which is a
      // logical parent of the other chunks at the same level. We need to move
      // the other chunks to be actual parents in our chunk map so that
      // closure-compiler properly understands the relationships.
      const childrenOfAsyncChunkMap = new Map();
      let extraAsyncChunkMap;
      childChunksMap.forEach((grandchildrenChunkMap, childChunk) => {
        if (childChunk.extraAsync) {
          extraAsyncChunkMap = grandchildrenChunkMap;
        } else {
          childrenOfAsyncChunkMap.set(childChunk, grandchildrenChunkMap);
        }
      });
      if (
        extraAsyncChunkMap &&
        childrenOfAsyncChunkMap.size !== childChunksMap.size
      ) {
        childrenOfAsyncChunkMap.forEach((grandchildrenChunkMap, childChunk) => {
          childChunksMap.delete(childChunk);
          extraAsyncChunkMap.set(childChunk, grandchildrenChunkMap);
        });
      }

      chunkMap.set(chunk, childChunksMap);
    }
  });

  return chunkMap;
}

module.exports = {
  /**
   * Webpack 3 and earlier: build a relationship map of chunks for the closure compiler
   * chunk graph. Starts by traversing all chunks without parents (entry points) and
   * walking their child chunks recursively.
   *
   * @param {!Array<Chunk>} allChunks
   * @param {?Chunk} parentChunk
   * @return {Array<!BasicChunkGroup>}
   */
  buildChunkGroupsFromChunks(chunks) {
    const chunkMap = buildChunkMap(chunks);

    const chunkGroups = [];
    function createGroupsForChunks(chunksMap, parentChunk) {
      const childChunkGroups = [];
      chunksMap.forEach((childChunksMap, chunk) => {
        const chunkGroup = parentChunk
          ? new Webpack3ChunkGroup([chunk])
          : new Webpack3Entrypoint([chunk]);
        if (parentChunk) {
          chunkGroup.parents_.push(parentChunk);
        }
        chunkGroups.push(chunkGroup);
        childChunkGroups.push(chunkGroup);
        chunkGroup.children_.splice(
          chunkGroup.children_.length,
          0,
          ...createGroupsForChunks(childChunksMap, chunk)
        );
      });
      return childChunkGroups;
    }
    createGroupsForChunks(chunkMap);
    return chunkGroups;
  },

  Webpack3Entrypoint,
  Webpack3ChunkGroup,
};
