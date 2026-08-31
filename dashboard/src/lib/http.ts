// The client's fetch → ok-check → JSON wrapper. Moved out of `views/folderView.tsx` (which now
// re-exports it for its existing importers). One canonical home for the small GET-JSON helper.

/** GET `url`, throw on a non-2xx status, and parse the body as JSON of type `T`. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
