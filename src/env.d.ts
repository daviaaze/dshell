/// <reference types="@girs/adw-1" />

export declare global {
  interface ImportMeta {
    name: string
    version: string
    domain: string
    datadir: string
    bindir: string
  }

  declare module "*.css" {
    const content: string
    export default content
  }
}
