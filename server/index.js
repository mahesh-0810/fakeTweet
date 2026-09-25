import './env.js'
import { createApp } from './app.js'
import { initDb, seedDb } from './db.js'

const PORT = process.env.PORT || 5000

async function main() {
  try {
    await initDb()
    await seedDb()
  } catch (err) {
    console.error('Fatal: failed to initialize database.')
    console.error(err)
    process.exit(1)
  }

  const app = createApp()
  app.listen(PORT, () => {
    console.log(`Chirp server listening on http://localhost:${PORT}`)
  })
}

main()
