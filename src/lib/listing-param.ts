// Next.js 16 delivers dynamic route segments still percent-encoded, and
// RentCast listing ids contain commas ("5529-Heisman-Dr,-Las-Vegas,-NV-89110")
// which arrive as %2C — decode before any DB lookup or the id never matches.
export function listingIdFromParam(raw: string): string {
  return decodeURIComponent(raw);
}
