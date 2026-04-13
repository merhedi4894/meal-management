import { createClient, type Client } from '@libsql/client'

const TURSO_URL = 'libsql://meal-management-merhedi4894.aws-ap-south-1.turso.io'
const TURSO_AUTH = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzUzOTY4MzksImlkIjoiMDE5ZDVkZTMtOWYwMS03YTkyLWE1MTMtN2Q5MGUyN2QyMTJkIiwicmlkIjoiZTk0M2RmNDQtZDVmZS00NDE4LTgxM2MtOWY2N2E5ZmIzY2FkIn0.n1VbU5K_fSRFVbvyqYGIHD9oU70HOncKpRH63G3sKXBDfcuWdDr8YZ3kZLP_Nh78QHPMGaqissZfW5a7BYTbBA'

let _client: Client | null = null

function getClient(): Client {
  if (!_client) {
    _client = createClient({
      url: TURSO_URL,
      authToken: TURSO_AUTH,
    })
  }
  return _client
}

// Raw SQL query helper
export async function query(sql: string, params: any[] = []) {
  const client = getClient()
  return client.execute({ sql, args: params })
}

// Batch execute multiple SQL statements in a single round-trip
export async function batchQuery(statements: Array<{ sql: string; args: any[] }>) {
  const client = getClient()
  return (client as any).batch(statements)
}

// Create indexes for commonly queried fields (idempotent)
let _indexesCreated = false
export async function ensureIndexes() {
  if (_indexesCreated) return
  try {
    await query('CREATE INDEX IF NOT EXISTS idx_meal_entry_officeId ON MealEntry(officeId)')
    await query('CREATE INDEX IF NOT EXISTS idx_meal_entry_month_year ON MealEntry(month, year)')
    await query('CREATE INDEX IF NOT EXISTS idx_meal_entry_entryDate ON MealEntry(entryDate)')
    await query('CREATE INDEX IF NOT EXISTS idx_meal_entry_depositDate ON MealEntry(depositDate)')
    // designation & department column যোগ করুন (idempotent)
    try { await query('ALTER TABLE MealEntry ADD COLUMN designation TEXT DEFAULT \'\'') } catch { /* column already exists */ }
    try { await query('ALTER TABLE MealEntry ADD COLUMN department TEXT DEFAULT \'\'') } catch { /* column already exists */ }
    // sourceOrderId column যোগ করুন (idempotent)
    try { await query('ALTER TABLE MealEntry ADD COLUMN sourceOrderId TEXT DEFAULT \'\'') } catch { /* column already exists */ }
    await query('CREATE INDEX IF NOT EXISTS idx_meal_entry_sourceOrderId ON MealEntry(sourceOrderId)')
    // MealOrder unique index — duplicate (officeId, orderDate) রো প্রতিরোধ
    try { await query('CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_order_unique ON MealOrder(officeId, orderDate)') } catch { /* index creation may fail if duplicates already exist */ }
    _indexesCreated = true
  } catch {
    // Index creation is best-effort, don't block app startup
  }
}
// Auto-create indexes on first import
ensureIndexes()

// Prisma-compatible db object using raw SQL
export const db = {
  mealEntry: {
    async findMany(args: any = {}) {
      const { where = {}, orderBy = {}, skip, take } = args
      let sql = 'SELECT * FROM MealEntry'
      const params: any[] = []
      const conditions: string[] = []

      if (where.officeId) { conditions.push('officeId = ?'); params.push(where.officeId) }
      if (where.month) { conditions.push('month = ?'); params.push(where.month) }
      if (where.year) { conditions.push('year = ?'); params.push(where.year) }
      if (where.id) { conditions.push('id = ?'); params.push(where.id) }
      if (where.OR) {
        const orParts: string[] = []
        for (const cond of where.OR) {
          if (cond.officeId?.contains) {
            orParts.push('officeId LIKE ?')
            params.push(`%${cond.officeId.contains}%`)
          }
          if (cond.mobile?.contains) {
            orParts.push('mobile LIKE ?')
            params.push(`%${cond.mobile.contains}%`)
          }
          if (cond.name?.contains) {
            orParts.push('name LIKE ?')
            params.push(`%${cond.name.contains}%`)
          }
        }
        if (orParts.length > 0) conditions.push(`(${orParts.join(' OR ')})`)
      }

      if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ')

      const orderCol = orderBy.entryDate ? 'entryDate' : orderBy.createdAt ? 'createdAt' : 'entryDate'
      const orderDir = (orderBy.entryDate || orderBy.createdAt || 'desc') === 'asc' ? 'ASC' : 'DESC'
      sql += ` ORDER BY ${orderCol} ${orderDir}`

      if (skip) { sql += ' LIMIT ? OFFSET ?'; params.push(take || 1000, skip) }
      else if (take) { sql += ' LIMIT ?'; params.push(take) }

      const result = await query(sql, params)
      return result.rows.map((row: any) => ({
        ...row,
        year: String(row.year || ''),
        breakfastCount: Number(row.breakfastCount) || 0,
        lunchCount: Number(row.lunchCount) || 0,
        morningSpecial: Number(row.morningSpecial) || 0,
        lunchSpecial: Number(row.lunchSpecial) || 0,
        totalBill: Number(row.totalBill) || 0,
        deposit: Number(row.deposit) || 0,
        prevBalance: Number(row.prevBalance) || 0,
        curBalance: Number(row.curBalance) || 0,
      }))
    },

    async findUnique(args: any) {
      const results = await this.findMany({ where: args.where })
      return results.length > 0 ? results[0] : null
    },

    async create(args: any) {
      const d = args.data
      const id = d.id || ('e_' + Date.now() + '_' + Math.random().toString(36).slice(2))
      const result = await query(
        `INSERT INTO MealEntry (id, entryDate, month, year, officeId, name, mobile, breakfastCount, lunchCount, morningSpecial, lunchSpecial, totalBill, deposit, depositDate, prevBalance, curBalance, designation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, d.entryDate || new Date().toISOString(), d.month, d.year, d.officeId, d.name || '', d.mobile || '', d.breakfastCount || 0, d.lunchCount || 0, d.morningSpecial || 0, d.lunchSpecial || 0, d.totalBill || 0, d.deposit || 0, d.depositDate || '', d.prevBalance || 0, d.curBalance || 0, d.designation || '']
      )
      return { ...d, id }
    },

    async update(args: any) {
      const { where, data } = args
      const sets: string[] = []
      const params: any[] = []
      for (const [key, val] of Object.entries(data)) {
        sets.push(`${key} = ?`)
        params.push(val)
      }
      params.push(where.id)
      await query(`UPDATE MealEntry SET ${sets.join(', ')} WHERE id = ?`, params)
      return { ...where, ...data }
    },

    async delete(args: any) {
      await query('DELETE FROM MealEntry WHERE id = ?', [args.where.id])
      return { id: args.where.id }
    },

    async deleteMany(args: any) {
      const conditions: string[] = []
      const params: any[] = []
      if (args.where?.month) { conditions.push('month = ?'); params.push(args.where.month) }
      if (args.where?.year) { conditions.push('year = ?'); params.push(args.where.year) }
      if (args.where?.officeId) { conditions.push('officeId = ?'); params.push(args.where.officeId) }
      const sql = conditions.length > 0 ? `DELETE FROM MealEntry WHERE ${conditions.join(' AND ')}` : 'DELETE FROM MealEntry'
      const result = await query(sql, params)
      return { count: result.rowsAffected || 0 }
    },

    async count(args: any = {}) {
      let sql = 'SELECT COUNT(*) as count FROM MealEntry'
      const params: any[] = []
      const conditions: string[] = []
      if (args.where?.officeId) { conditions.push('officeId = ?'); params.push(args.where.officeId) }
      if (args.where?.month) { conditions.push('month = ?'); params.push(args.where.month) }
      if (args.where?.year) { conditions.push('year = ?'); params.push(args.where.year) }
      if (args.where?.OR) {
        const orParts: string[] = []
        for (const cond of args.where.OR) {
          if (cond.officeId?.contains) { orParts.push('officeId LIKE ?'); params.push(`%${cond.officeId.contains}%`) }
          if (cond.mobile?.contains) { orParts.push('mobile LIKE ?'); params.push(`%${cond.mobile.contains}%`) }
        }
        if (orParts.length > 0) conditions.push(`(${orParts.join(' OR ')})`)
      }
      if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ')
      const result = await query(sql, params)
      return Number(result.rows[0].count)
    },

    // distinct query for officeIds
    async findManyDistinct(args: any) {
      const result = await query('SELECT DISTINCT officeId FROM MealEntry')
      return result.rows.map((row: any) => ({ officeId: row.officeId }))
    },

    // bulk update — সব entry update করুন যেখানে officeId মিলে
    async updateMany(args: any) {
      const { where, data } = args
      const sets: string[] = []
      const params: any[] = []
      for (const [key, val] of Object.entries(data)) {
        sets.push(`${key} = ?`)
        params.push(val)
      }
      if (where.officeId) { params.push(where.officeId) }
      const whereClause = where.officeId ? ' WHERE officeId = ?' : ''
      const result = await query(`UPDATE MealEntry SET ${sets.join(', ')}${whereClause}`, params)
      return { count: result.rowsAffected || 0 }
    }
  },

  priceSetting: {
    async findMany(args: any = {}) {
      let sql = 'SELECT * FROM PriceSetting'
      if (args.orderBy) {
        sql += ' ORDER BY year DESC, month ASC'
      }
      const result = await query(sql)
      return result.rows.map((row: any) => ({
        ...row,
        breakfastPrice: Number(row.breakfastPrice) || 0,
        lunchPrice: Number(row.lunchPrice) || 0,
        morningSpecial: Number(row.morningSpecial) || 0,
        lunchSpecial: Number(row.lunchSpecial) || 0,
      }))
    },

    async findUnique(args: any) {
      const { month, year } = args.where.month_year || args.where
      const result = await query('SELECT * FROM PriceSetting WHERE month = ? AND year = ?', [month, year])
      if (result.rows.length > 0) {
        const row = result.rows[0]
        return {
          ...row,
          breakfastPrice: Number(row.breakfastPrice) || 0,
          lunchPrice: Number(row.lunchPrice) || 0,
          morningSpecial: Number(row.morningSpecial) || 0,
          lunchSpecial: Number(row.lunchSpecial) || 0,
        }
      }
      return null
    },

    async upsert(args: any) {
      const { where, update, create } = args
      const { month, year } = where.month_year || where
      const existing = await this.findUnique({ where: { month_year: { month, year } } })
      if (existing) {
        await query(
          'UPDATE PriceSetting SET breakfastPrice = ?, lunchPrice = ?, morningSpecial = ?, lunchSpecial = ? WHERE month = ? AND year = ?',
          [create.breakfastPrice, create.lunchPrice, create.morningSpecial, create.lunchSpecial, month, year]
        )
        return { ...existing, ...create }
      }
      await query(
        'INSERT INTO PriceSetting (id, month, year, breakfastPrice, lunchPrice, morningSpecial, lunchSpecial) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['ps_' + month + '_' + year, month, year, create.breakfastPrice || 0, create.lunchPrice || 0, create.morningSpecial || 0, create.lunchSpecial || 0]
      )
      return { id: 'ps_' + month + '_' + year, ...create }
    },

    async update(args: any) {
      const { where, data } = args
      await query(
        'UPDATE PriceSetting SET breakfastPrice = ?, lunchPrice = ?, morningSpecial = ?, lunchSpecial = ? WHERE id = ?',
        [data.breakfastPrice, data.lunchPrice, data.morningSpecial, data.lunchSpecial, where.id]
      )
      return { ...where, ...data }
    },

    async delete(args: any) {
      await query('DELETE FROM PriceSetting WHERE id = ?', [args.where.id])
      return { id: args.where.id }
    },

    async count() {
      const result = await query('SELECT COUNT(*) as count FROM PriceSetting')
      return Number(result.rows[0].count)
    },

    async deleteMany() {
      await query('DELETE FROM PriceSetting')
      return { count: 1 }
    }
  },

  officeMember: {
    async findMany(args: any = {}) {
      const { orderBy, take } = args
      let sql = 'SELECT * FROM OfficeMember'
      if (orderBy) sql += ' ORDER BY createdAt DESC'
      if (take) sql += ` LIMIT ${take}`
      const result = await query(sql)
      return result.rows
    },
    async findUnique(args: any) {
      const { officeId } = args.where
      const result = await query('SELECT * FROM OfficeMember WHERE officeId = ?', [officeId])
      return result.rows.length > 0 ? result.rows[0] : null
    },
    async create(args: any) {
      const { officeId, name, designation, mobile, department } = args.data
      await query(
        'INSERT INTO OfficeMember (officeId, name, designation, mobile, department) VALUES (?, ?, ?, ?, ?)',
        [officeId, name || '', designation || '', mobile || '', department || '']
      )
      return { officeId, name, designation, mobile, department }
    },
    async update(args: any) {
      const { where, data } = args
      const sets: string[] = []
      const params: any[] = []
      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined) { sets.push(`${key} = ?`); params.push(val) }
      }
      if (sets.length > 0) {
        params.push(where.officeId)
        await query(`UPDATE OfficeMember SET ${sets.join(', ')} WHERE officeId = ?`, params)
      }
      return { ...where, ...data }
    }
  },

  systemSetting: {
    async findUnique(args: any) {
      const { key } = args.where
      try {
        const result = await query('SELECT * FROM SystemSetting WHERE key = ?', [key])
        if (result.rows.length > 0) {
          return { key: result.rows[0].key, value: result.rows[0].value }
        }
        return null
      } catch {
        return null
      }
    },

    async upsert(args: any) {
      const { where, update, create } = args
      const key = where.key
      try {
        const existing = await this.findUnique({ where: { key } })
        if (existing) {
          await query('UPDATE SystemSetting SET value = ? WHERE key = ?', [update.value || create.value, key])
          return { key, value: update.value || create.value }
        }
        await query('INSERT INTO SystemSetting (key, value) VALUES (?, ?)', [key, create.value])
        return { key, value: create.value }
      } catch {
        // টেবিল না থাকলে তৈরি করুন
        try {
          await query('CREATE TABLE IF NOT EXISTS SystemSetting (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
          await query('INSERT INTO SystemSetting (key, value) VALUES (?, ?)', [key, create.value])
          return { key, value: create.value }
        } catch {
          throw new Error('SystemSetting টেবিল তৈরি করা যায়নি')
        }
      }
    }
  }
}
