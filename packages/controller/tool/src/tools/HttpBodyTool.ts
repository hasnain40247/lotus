/**
 * HttpBodyTool — bounded HTTP response body collection helper.
 *
 * Ported from @neko/core tool/http-body.ts.
 * Logic kept identical.
 */
export * as HttpBodyTool from "./HttpBodyTool"

import { Effect, Stream } from "effect"

export interface HttpResponseLike {
  readonly headers: Record<string, string | undefined>
  readonly stream: Stream.Stream<Uint8Array, unknown>
}

/**
 * Collect a bounded HTTP response body, failing with the given error if the
 * body exceeds `maximumBytes`.
 */
export const collectBoundedResponseBody = (
  response: HttpResponseLike,
  maximumBytes: number,
  tooLarge: () => Error,
): Effect.Effect<Buffer, Error> =>
  Effect.gen(function* () {
    const contentLength = response.headers["content-length"]
    const parsedSize = contentLength ? Number.parseInt(contentLength, 10) : undefined
    const declaredSize =
      parsedSize !== undefined && Number.isSafeInteger(parsedSize) && parsedSize >= 0
        ? parsedSize
        : undefined
    if (declaredSize !== undefined && declaredSize > maximumBytes) return yield* Effect.fail(tooLarge())
    let body = Buffer.allocUnsafe(Math.min(maximumBytes, declaredSize || 64 * 1024))
    let size = 0
    yield* Stream.runForEach(response.stream as Stream.Stream<Uint8Array>, (chunk) => {
      if (chunk.byteLength === 0) return Effect.void
      if (size + chunk.byteLength > maximumBytes) return Effect.fail(tooLarge()) as any
      if (size + chunk.byteLength > body.byteLength) {
        const grown = Buffer.allocUnsafe(
          Math.min(maximumBytes, Math.max(size + chunk.byteLength, body.byteLength * 2)),
        )
        body.copy(grown, 0, 0, size)
        body = grown
      }
      body.set(chunk, size)
      size += chunk.byteLength
      return Effect.void
    })
    return body.subarray(0, size) as unknown as Buffer
  }) as Effect.Effect<Buffer, Error>
