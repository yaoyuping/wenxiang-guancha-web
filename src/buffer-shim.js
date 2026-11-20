export const Buffer = {
  byteLength(value) {
    return new TextEncoder().encode(value).length;
  },
};
