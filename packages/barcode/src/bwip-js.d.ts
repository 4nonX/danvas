// The part of bwip-js this package uses. Its own typings are reachable only
// through package exports, which the CommonJS build here does not resolve.
declare module "bwip-js" {
  interface LinearRaw {
    sbs: number[];
    bhs: number[];
    bbs: number[];
    txt?: [string, number, number, string, number][];
  }
  interface MatrixRaw {
    pixs: number[];
    pixx: number;
    pixy: number;
  }
  const bwipjs: { raw(bcid: string, text: string, opts: string): Array<LinearRaw | MatrixRaw> };
  export default bwipjs;
}
