const fs = require('node:fs')
const catalog = require('../src/lib/hash/data/category-catalog.json')

async function main() {
  const origin = process.env.HASH_BACKEND_URL
  const token = process.env.HASH_ADMIN_TOKEN
  if (!origin || !token) throw new Error('Set HASH_BACKEND_URL and HASH_ADMIN_TOKEN')
  async function request(path, body) {
    const response = await fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'Category request failed')
    return result
  }
  const { categories } = await request('/admin/hash/categories')
  if (process.env.HASH_CATEGORY_BACKUP) fs.writeFileSync(process.env.HASH_CATEGORY_BACKUP, JSON.stringify(categories, null, 2), { mode: 0o600 })
  const plans = catalog.map(template => {
    const existing = categories.find(c => c.handle === template.handle)
    // Retain the Operations team's edits, field choices, visibility and ordering.
    const specifications = [...(existing?.specifications || [])]
    for (const field of template.specifications) {
      if (!specifications.some(d => d.key === field.key)) specifications.push(field)
    }
    return {
      ...(existing ? { id: existing.id } : {}),
      handle: template.handle,
      name: existing?.name || template.name,
      description: existing?.description || template.description,
      rank: existing?.rank ?? 10 + catalog.indexOf(template),
      is_active: existing?.is_active ?? true,
      specifications
    }
  })
  // Persist keyboard defaults too, so Operations owns the complete configuration.
  for (const category of categories.filter(c => ['keyboard', 'keyboards'].includes(c.handle))) {
    plans.push({ id: category.id, handle: category.handle, name: category.name, description: category.description || '', rank: category.rank, is_active: category.is_active, specifications: category.specifications })
  }
  for (const plan of plans) {
    await request('/admin/hash/categories', plan)
    console.log(plan.name + ': ' + plan.specifications.length + ' specifications configured')
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
