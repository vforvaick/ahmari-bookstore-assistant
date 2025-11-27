const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

async function initDatabase(dbPath) {
  const schema = fs.readFileSync(
    path.join(__dirname, 'schema.sql'),
    'utf-8'
  );

  const db = new sqlite3.Database(dbPath);

  return new Promise((resolve, reject) => {
    db.exec(schema, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log('✓ Database initialized successfully');
        db.close();
        resolve();
      }
    });
  });
}

module.exports = { initDatabase };

// Run if called directly
if (require.main === module) {
  const dbPath = process.env.DATABASE_PATH || './data/bookstore.db';
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  initDatabase(dbPath)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Failed to initialize database:', err);
      process.exit(1);
    });
}
