// === /items ===
// Visualises every catalogued combat-viable equipment piece grouped by its
// source pool. Lets you scan what's covered (and by elimination, what's
// missing) across vendor shops, boss drops, quest rewards, slayer drops,
// minigame rewards, and skill-unlock items.
'use client';

import { useMemo, useState } from 'react';
import { vendorStarterItems, VendorItem } from '@/upgrade/lib/vendorStarter';
import { bossDrops, BossDropItem } from '@/upgrade/lib/bossDrops';
import { miscDrops, MiscDropItem, MiscSourceKind } from '@/upgrade/lib/miscDrops';

// === Row shape — one per unique itemId+name+version within a group ===
interface ItemRow {
  itemId: number;
  name: string;
  version: string;
  slot: string;
  /** Human-readable source names (shops, bosses, misc-source names). */
  sources: string[];
  /** Long-form skill thresholds, e.g. { magic: 60 }. */
  requirements: Record<string, number>;
}

// === Group definition ===
interface Group {
  key: string;
  label: string;
  items: ItemRow[];
}

// === Aggregators ===

function vendorRows(): ItemRow[] {
  // Dedupe vendor items by itemId (same item in multiple shops collapses to
  // one row with the union of shop names).
  const byId = new Map<number, ItemRow>();
  for (const v of vendorStarterItems as VendorItem[]) {
    const sources = v.shops.map((s) => `${s.shop} (${s.location})`);
    const existing = byId.get(v.itemId);
    if (existing) {
      const set = new Set([...existing.sources, ...sources]);
      existing.sources = [...set];
    } else {
      byId.set(v.itemId, {
        itemId: v.itemId,
        name: v.name,
        version: v.version,
        slot: v.slot,
        sources,
        requirements: v.requirements,
      });
    }
  }
  return [...byId.values()];
}

function bossRows(): ItemRow[] {
  // Dedupe boss drops by itemId across bosses.
  const byId = new Map<number, ItemRow>();
  for (const boss of bossDrops) {
    for (const drop of boss.drops as BossDropItem[]) {
      const existing = byId.get(drop.itemId);
      if (existing) {
        if (!existing.sources.includes(boss.boss)) existing.sources.push(boss.boss);
      } else {
        byId.set(drop.itemId, {
          itemId: drop.itemId,
          name: drop.name,
          version: drop.version,
          slot: drop.slot,
          sources: [boss.boss],
          requirements: drop.requirements,
        });
      }
    }
  }
  return [...byId.values()];
}

function miscRows(kind: MiscSourceKind): ItemRow[] {
  // Dedupe by itemId WITHIN the requested kind. An item that drops from
  // both a slayer monster and a minigame appears in both groups, which is
  // intended for "what's missing" scanning.
  const byId = new Map<number, ItemRow>();
  for (const src of miscDrops) {
    if (src.kind !== kind) continue;
    for (const drop of src.drops as MiscDropItem[]) {
      const existing = byId.get(drop.itemId);
      if (existing) {
        if (!existing.sources.includes(src.source)) existing.sources.push(src.source);
      } else {
        byId.set(drop.itemId, {
          itemId: drop.itemId,
          name: drop.name,
          version: drop.version,
          slot: drop.slot,
          sources: [src.source],
          requirements: drop.requirements,
        });
      }
    }
  }
  return [...byId.values()];
}

// === Slot ordering for stable sort within a group ===
const SLOT_ORDER = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'];
function slotIdx(s: string): number {
  const i = SLOT_ORDER.indexOf(s);
  return i === -1 ? 99 : i;
}

function sortRows(rows: ItemRow[]): ItemRow[] {
  return [...rows].sort((a, b) => {
    const s = slotIdx(a.slot) - slotIdx(b.slot);
    if (s !== 0) return s;
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return a.version.localeCompare(b.version);
  });
}

// === Reqs pretty-printer ===
function fmtReqs(reqs: Record<string, number>): string {
  const entries = Object.entries(reqs);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k} ${v}`).join(', ');
}

// === Row cell ===
function ItemRowDisplay({ row, query }: { row: ItemRow; query: string }) {
  const matches = !query || row.name.toLowerCase().includes(query)
    || row.sources.some((s) => s.toLowerCase().includes(query));
  if (!matches) return null;
  return (
    <tr style={{ borderBottom: '1px solid #1f1f1f' }}>
      <td style={{ padding: '0.3rem 0.5rem', color: '#ddd', whiteSpace: 'nowrap' }}>
        {row.name}{row.version ? ` (${row.version})` : ''}
      </td>
      <td style={{ padding: '0.3rem 0.5rem', color: '#888', fontSize: '0.75rem' }}>{row.slot}</td>
      <td style={{ padding: '0.3rem 0.5rem', color: '#888', fontSize: '0.75rem' }}>{fmtReqs(row.requirements)}</td>
      <td style={{ padding: '0.3rem 0.5rem', color: '#aaa', fontSize: '0.75rem' }}>{row.sources.join(' · ')}</td>
    </tr>
  );
}

// === Section ===
function GroupSection({ group, query }: { group: Group; query: string }) {
  const rows = useMemo(() => sortRows(group.items), [group.items]);
  // Pre-filter for the count so the header reflects matches when searching.
  const matchCount = useMemo(() => {
    if (!query) return rows.length;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(query)
      || r.sources.some((s) => s.toLowerCase().includes(query))
    ).length;
  }, [rows, query]);

  return (
    <section style={{ marginTop: '1.25rem' }}>
      <h2 style={{
        margin: '0 0 0.5rem', fontSize: '1.05rem', color: '#cce0f5',
        borderBottom: '1px solid #333', paddingBottom: '0.25rem',
      }}>
        {group.label}{' '}
        <span style={{ color: '#666', fontSize: '0.85rem', fontWeight: 'normal' }}>
          ({matchCount}{query && matchCount !== rows.length ? ` of ${rows.length}` : ''})
        </span>
      </h2>
      {matchCount === 0 ? (
        <p style={{ color: '#555', fontSize: '0.8rem', fontStyle: 'italic', margin: 0 }}>no matches</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ color: '#888', fontSize: '0.7rem', textAlign: 'left' }}>
              <th style={{ padding: '0.2rem 0.5rem', fontWeight: 'normal' }}>Item</th>
              <th style={{ padding: '0.2rem 0.5rem', fontWeight: 'normal' }}>Slot</th>
              <th style={{ padding: '0.2rem 0.5rem', fontWeight: 'normal' }}>Wield reqs</th>
              <th style={{ padding: '0.2rem 0.5rem', fontWeight: 'normal' }}>Sources</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <ItemRowDisplay key={`${group.key}-${r.itemId}-${r.version}`} row={r} query={query} />)}
          </tbody>
        </table>
      )}
    </section>
  );
}

// === Page ===
export default function ItemsPage() {
  const groups = useMemo<Group[]>(() => [
    { key: 'vendor', label: 'Vendor items', items: vendorRows() },
    { key: 'boss', label: 'Boss drops', items: bossRows() },
    { key: 'quest', label: 'Quest rewards', items: miscRows('quest_reward') },
    { key: 'slayer', label: 'Slayer monster drops', items: miscRows('slayer_monster') },
    { key: 'minigame', label: 'Minigame rewards', items: miscRows('minigame') },
    { key: 'skill', label: 'Skill / diary unlocks', items: miscRows('skill_unlock') },
    { key: 'crafted', label: 'Crafted (Smithing / Fletching / Crafting)', items: miscRows('crafted') },
  ], []);

  const [rawQuery, setRawQuery] = useState('');
  const query = rawQuery.trim().toLowerCase();

  // Cross-group dedup count (an item could be in vendor + boss + misc; this
  // shows the deduped union across all six groups).
  const totalUnique = useMemo(() => {
    const ids = new Set<number>();
    for (const g of groups) for (const r of g.items) ids.add(r.itemId);
    return ids.size;
  }, [groups]);

  const totalRows = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: '1.5rem' }}>
      <h1 style={{ margin: '0 0 0.5rem' }}>Catalogued equipment</h1>
      <p style={{ color: '#888', marginTop: 0, fontSize: '0.85rem' }}>
        Every combat-viable item the simulator knows about, grouped by source pool.
        An item can appear in multiple groups when it has multiple sources (e.g.
        Dragon dagger drops from a boss AND sells from a shop). Use search to filter
        by item name or source name.
      </p>
      <p style={{ color: '#666', marginTop: '0.25rem', fontSize: '0.8rem' }}>
        {totalRows} rows across {groups.length} groups · {totalUnique} unique itemIds union
      </p>

      <section style={{ marginTop: '0.75rem' }}>
        <input
          type="text"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          placeholder="filter by item name or source…"
          style={{
            width: '100%',
            maxWidth: 400,
            padding: '0.4rem 0.6rem',
            fontSize: '0.9rem',
            border: '1px solid #444',
            background: '#1a1a1a',
            color: '#ddd',
            borderRadius: 4,
          }}
        />
      </section>

      {groups.map((g) => <GroupSection key={g.key} group={g} query={query} />)}
    </main>
  );
}
