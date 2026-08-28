# Time-Windowed Unique Counts (addressCount / signatureCount)

## Context

`addressCount` on signatures and `signatureCount` on addresses accumulate forever since server start. We want 15m and 24h windowed counts, like request counts already have via the `Speed` class.

## Problem

- `signature.js` enricher collects addresses in an Immutable `Set` — grows forever
- `address.js` enricher collects signatures in an Immutable `Set` — grows forever
- `Speed` class only handles numeric counters, not unique item sets

## Approach: SpeedSet class

Create a `SpeedSet` class following the same sliding-window pattern as `Speed`, but tracking unique items per time bucket.

- Same gc/bucketing as Speed (windowSize + bucket count)
- `hit(item)` adds item to current bucket's Set
- `uniqueCount()` merges all active bucket Sets, returns distinct count
- `toJSON`/`fromJSON` for persistence (Sets serialized as arrays)

## Files to modify

### 1. Create `src/lib/speed-set.js`

```js
class SpeedSet {
  constructor(windowSize, size) { ... }
  hit(item, time) { ... }    // add item to current bucket Set
  gc() { ... }               // drop old buckets
  uniqueCount() { ... }      // merge active buckets, return .size
  toJSON() / fromJSON() { ... }
}
```

### 2. Modify `src/modules/signature.js`

- In enricher: create/update SpeedSet instances for address tracking per 15m/24h
- Store on entry as `addressSpeed.per_minute` and `addressSpeed.per_hour`
- Add formatter fields `addressCount15m` and `addressCount24h`
- Add sorters for both
- Keep forever `addresses` Set (still needed for address list display)

### 3. Modify `src/modules/address.js`

- Same pattern: SpeedSet instances for signature tracking
- Store as `signatureSpeed.per_minute` / `signatureSpeed.per_hour`
- Add formatter fields `signatureCount15m`, `signatureCount24h`
- Add sorters
- Keep forever `signatures` Set for total count

### 4. Modify dashboard pages

- `Signatures.jsx`: show `addressCount15m`/`addressCount24h` based on time window toggle
- `Addresses.jsx`: show `signatureCount15m`/`signatureCount24h` based on time window toggle

### 5. Rebuild dashboard

## Verification

- Restart hyperwatch, wait for traffic
- `/signatures.json` — `addressCount15m`/`addressCount24h` should be smaller than `addressCount`
- `/addresses.json` — `signatureCount15m`/`signatureCount24h` should appear
- Dashboard columns switch with time window toggle
