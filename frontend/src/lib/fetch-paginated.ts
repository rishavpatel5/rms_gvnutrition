import { apiGetJsonAuthedWithMeta, type PaginationMeta } from "@/lib/api-client";

/** Fetches every page for a list endpoint (max 100 items per page). */
export async function fetchAllPaginated<T>(buildUrl: (page: number) => string): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const { data, meta } = await apiGetJsonAuthedWithMeta<T[]>(buildUrl(page));
    all.push(...data);
    totalPages = meta?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return all;
}

/**
 * Every row of a list endpoint, given its path with or without a query string.
 * The server caps `limit` at 100, so asking for `limit=200` in one request
 * silently drops everything past row 100 — always page through instead.
 */
export function fetchAllRows<T>(path: string): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  return fetchAllPaginated<T>((page) => `${path}${sep}limit=100&page=${page}`);
}

export async function fetchListMeta(buildUrl: (page: number) => string): Promise<PaginationMeta> {
  const { meta } = await apiGetJsonAuthedWithMeta<unknown[]>(buildUrl(1));
  return meta ?? { page: 1, limit: 100, total: 0, totalPages: 0 };
}
