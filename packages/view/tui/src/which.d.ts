declare module "which" {
  interface WhichOptions {
    nothrow?: boolean
    path?: string
    pathExt?: string
  }
  interface WhichModule {
    sync(cmd: string, options?: WhichOptions): string | null
  }
  const which: WhichModule
  export default which
}
