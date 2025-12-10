// server.js
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Read connection string from env
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL missing in .env');
  process.exit(1);
}

// Create pool
const pool = new Pool({
  connectionString,
  // neon requires ssl - connection string already contains sslmode=require,
  // but in node pg you might need to set rejectUnauthorized depending on env.
  // If you run into SSL errors, set ssl: { rejectUnauthorized: false }
  // ssl: { rejectUnauthorized: false }
});

async function initDb() {
  // Create table if not exists
  const createTableSQL = `
  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    ext_id INTEGER,
    name TEXT NOT NULL,
    category TEXT,
    price NUMERIC(10,2) NOT NULL,
    image TEXT,
    stock INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  );
  `;
  await pool.query(createTableSQL);

  // Check if table empty, and seed with initial products if empty
  const { rows } = await pool.query('SELECT COUNT(*)::int AS cnt FROM products;');
  const count = rows[0].cnt;
  if (count === 0) {
    console.log('Seeding products table...');
    const products = [
      { ext_id:1, name:'Classic White T-Shirt', category:'tshirts', price:19.99, image:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400', stock:50 },
      { ext_id:2, name:'Cotton Polo Shirt', category:'shirts', price:29.99, image:'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400', stock:30 },
      { ext_id:3, name:'Slim Fit Blue Jeans', category:'jeans', price:49.99, image:'https://images.unsplash.com/photo-1542272454315-7f6d6f9a0cbe?w=400', stock:25 },
      { ext_id:4, name:'Casual Chino Pants', category:'pants', price:39.99, image:'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=400', stock:40 },
      { ext_id:5, name:'Graphic Print T-Shirt', category:'tshirts', price:24.99, image:'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=400', stock:60 },
      { ext_id:6, name:'Formal Dress Shirt', category:'shirts', price:44.99, image:'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400', stock:20 },
      { ext_id:7, name:'Black Skinny Jeans', category:'jeans', price:54.99, image:'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400', stock:8 },
      { ext_id:8, name:'Cargo Pants', category:'pants', price:42.99, image:'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400', stock:28 },
      { ext_id:9, name:'V-Neck T-Shirt', category:'tshirts', price:22.99, image:'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=400', stock:45 },
      { ext_id:10, name:'Denim Jacket', category:'shirts', price:69.99, image:'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=400', stock:15 },
      { ext_id:11, name:'Ripped Jeans', category:'jeans', price:59.99, image:'https://images.unsplash.com/photo-1584370848010-d7fe6bc767ec?w=400', stock:22 },
      { ext_id:12, name:'Jogger Pants', category:'pants', price:36.99, image:'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400', stock:35 }
    ];

    // Insert in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertText = `
        INSERT INTO products (ext_id, name, category, price, image, stock)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      for (const p of products) {
        await client.query(insertText, [p.ext_id, p.name, p.category, p.price, p.image, p.stock]);
      }
      await client.query('COMMIT');
      console.log('Seed complete.');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error seeding products:', err);
    } finally {
      client.release();
    }
  } else {
    console.log(`Products table already has ${count} rows, skip seeding.`);
  }
}

// API: Get products with optional category and search query
app.get('/api/products', async (req, res) => {
  try {
    const qCategory = req.query.category;
    const qSearch = req.query.search;
    let base = 'SELECT id, ext_id, name, category, price::numeric::float8 AS price, image, stock FROM products';
    const where = [];
    const params = [];
    if (qCategory && qCategory !== 'all') {
      params.push(qCategory);
      where.push(`category = $${params.length}`);
    }
    if (qSearch) {
      params.push(`%${qSearch.toLowerCase()}%`);
      where.push(`LOWER(name) LIKE $${params.length}`);
    }
    if (where.length) base += ' WHERE ' + where.join(' AND ');
    base += ' ORDER BY id';
    const { rows } = await pool.query(base, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/products error', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// (Optional) API to add a product (secure this in production)
app.post('/api/products', async (req, res) => {
  try {
    const { name, category, price, image, stock, ext_id } = req.body;
    const insert = `INSERT INTO products (ext_id, name, category, price, image, stock) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`;
    const { rows } = await pool.query(insert, [ext_id || null, name, category, price, image, stock || 0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /api/products error', err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Serve static frontend from public/
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server started at http://localhost:${port}`);
    });
  })
  .catch(err => {
    console.error('DB init failed:', err);
    process.exit(1);
  });
