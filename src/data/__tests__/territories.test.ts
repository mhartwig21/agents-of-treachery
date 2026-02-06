import { describe, it, expect } from 'vitest'
import { territories, getTerritory, getPathCenter, getTerritoryCenter } from '../territories'

describe('Territory data integrity', () => {
  it('should have no duplicate territory IDs', () => {
    const ids = territories.map(t => t.id)
    const unique = new Set(ids)
    expect(ids.length).toBe(unique.size)
  })

  it('should have no duplicate SVG paths between territories', () => {
    // Only check non-coastal-variant territories (skip _nc, _sc, _ec variants)
    const mainTerritories = territories.filter(t => !t.id.includes('_'))
    const pathMap = new Map<string, string[]>()

    for (const t of mainTerritories) {
      const existing = pathMap.get(t.path) || []
      existing.push(t.id)
      pathMap.set(t.path, existing)
    }

    const duplicates = [...pathMap.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([, ids]) => ids)

    expect(duplicates).toEqual([])
  })

  it('should have valid SVG paths for all territories', () => {
    for (const t of territories) {
      expect(t.path, `${t.id} should have a path starting with M`).toMatch(/^M\s/)
    }
  })
})

describe('Turkey territory paths', () => {
  const turkeyIds = ['con', 'ank', 'smy', 'arm']

  it('should have all four Turkey territories', () => {
    for (const id of turkeyIds) {
      const territory = getTerritory(id)
      expect(territory, `Territory ${id} should exist`).toBeDefined()
    }
  })

  it('Constantinople should not use Albania path', () => {
    const con = getTerritory('con')!
    const alb = getTerritory('alb')!
    expect(con.path).not.toBe(alb.path)
  })

  it('Constantinople path should be in eastern Mediterranean region', () => {
    // Constantinople is near the Bosphorus (~x:1290-1420, ~y:1260-1370)
    // Albania is in the western Balkans (~x:1100-1150, ~y:1260-1360)
    const con = getTerritory('con')!
    const center = getPathCenter(con.path)

    // Constantinople center should be east of x:1250 (not in Albania region ~1125)
    expect(center.x).toBeGreaterThan(1250)
    // And within the Bosphorus latitude range
    expect(center.y).toBeGreaterThan(1260)
    expect(center.y).toBeLessThan(1380)
  })

  it('Ankara should be east of Constantinople', () => {
    const con = getTerritory('con')!
    const ank = getTerritory('ank')!
    const conCenter = getPathCenter(con.path)
    const ankCenter = getPathCenter(ank.path)

    expect(ankCenter.x).toBeGreaterThan(conCenter.x)
  })

  it('Smyrna should be south/southwest of Ankara', () => {
    const ank = getTerritory('ank')!
    const smy = getTerritory('smy')!
    const ankCenter = getPathCenter(ank.path)
    const smyCenter = getPathCenter(smy.path)

    // Smyrna is on the Aegean coast, west of Ankara
    expect(smyCenter.x).toBeLessThan(ankCenter.x)
    // Smyrna extends further south than Ankara
    expect(smyCenter.y).toBeGreaterThan(ankCenter.y)
  })

  it('Armenia should be east of Ankara', () => {
    const ank = getTerritory('ank')!
    const arm = getTerritory('arm')!
    const ankCenter = getPathCenter(ank.path)
    const armCenter = getPathCenter(arm.path)

    expect(armCenter.x).toBeGreaterThan(ankCenter.x)
  })

  it('Turkey territories should have correct neighbors', () => {
    const con = getTerritory('con')!
    expect(con.neighbors).toContain('ank')
    expect(con.neighbors).toContain('smy')
    expect(con.neighbors).toContain('bla')
    expect(con.neighbors).toContain('bul')
    expect(con.neighbors).toContain('aeg')

    const ank = getTerritory('ank')!
    expect(ank.neighbors).toContain('con')
    expect(ank.neighbors).toContain('smy')
    expect(ank.neighbors).toContain('arm')
    expect(ank.neighbors).toContain('bla')

    const smy = getTerritory('smy')!
    expect(smy.neighbors).toContain('con')
    expect(smy.neighbors).toContain('ank')
    expect(smy.neighbors).toContain('arm')
    expect(smy.neighbors).toContain('aeg')
    expect(smy.neighbors).toContain('eas')

    const arm = getTerritory('arm')!
    expect(arm.neighbors).toContain('ank')
    expect(arm.neighbors).toContain('smy')
    expect(arm.neighbors).toContain('sev')
    expect(arm.neighbors).toContain('bla')
  })

  it('Turkey supply centers should be correct', () => {
    expect(getTerritory('con')!.supplyCenter).toBe(true)
    expect(getTerritory('ank')!.supplyCenter).toBe(true)
    expect(getTerritory('smy')!.supplyCenter).toBe(true)
    expect(getTerritory('arm')!.supplyCenter).toBe(false)
  })

  it('Constantinople should have multi-part path for straits', () => {
    const con = getTerritory('con')!
    // Constantinople has multiple M commands (European + Asian side paths)
    const mCount = (con.path.match(/M\s/g) || []).length
    expect(mCount).toBeGreaterThanOrEqual(2)
  })

  it('getTerritoryCenter should return valid positions for Turkey territories', () => {
    for (const id of turkeyIds) {
      const center = getTerritoryCenter(id)
      expect(center, `${id} should have a computable center`).toBeDefined()
      expect(center!.x).toBeGreaterThan(0)
      expect(center!.y).toBeGreaterThan(0)
      expect(center!.x).toBeLessThan(1835) // within viewBox width
      expect(center!.y).toBeLessThan(1500) // reasonable map extent
    }
  })
})
