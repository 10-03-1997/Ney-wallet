const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET";

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      phone: user.phone,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Token de autenticação necessário",
    });
  }

  const token = header.substring(7);

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Token inválido ou expirado",
    });
  }
}

app.get("/", (req, res) => {
  res.json({
    name: "NeyWallet Backend",
    version: "1.0.0",
    status: "online",
    environment: "sandbox",
    currency: "MZN",
  });
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      database: "disconnected",
    });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({
        error: "Nome, telefone e senha são obrigatórios",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "A senha deve ter pelo menos 6 caracteres",
      });
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE phone = $1 OR ($2::text IS NOT NULL AND email = $2)",
      [phone, email || null]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: "Telefone ou email já registado",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users
       (name, phone, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone, email, balance, currency, created_at`,
      [name, phone, email || null, passwordHash]
    );

    const user = result.rows[0];

    res.status(201).json({
      message: "Conta criada com sucesso",
      token: createToken(user),
      user,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Erro ao criar conta",
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        error: "Telefone e senha são obrigatórios",
      });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE phone = $1",
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Credenciais inválidas",
      });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        error: "Credenciais inválidas",
      });
    }

    delete user.password_hash;

    res.json({
      message: "Login efetuado com sucesso",
      token: createToken(user),
      user,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Erro ao efetuar login",
    });
  }
});

app.get("/api/wallet", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, phone, email, balance, currency, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Utilizador não encontrado",
      });
    }

    res.json({
      wallet: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Erro ao consultar carteira",
    });
  }
});

app.post(
  "/api/transactions/transfer",
  authMiddleware,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { receiver_phone, amount, description } = req.body;

      const value = Number(amount);

      if (!receiver_phone || !Number.isFinite(value) || value <= 0) {
        return res.status(400).json({
          error: "Destinatário e valor válido são obrigatórios",
        });
      }

      if (receiver_phone === req.user.phone) {
        return res.status(400).json({
          error: "Não pode transferir para si próprio",
        });
      }

      await client.query("BEGIN");

      const senderResult = await client.query(
        "SELECT id, balance FROM users WHERE id = $1 FOR UPDATE",
        [req.user.id]
      );

      if (senderResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "Remetente não encontrado",
        });
      }

      const sender = senderResult.rows[0];

      if (Number(sender.balance) < value) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error: "Saldo insuficiente",
        });
      }

      const receiverResult = await client.query(
        "SELECT id FROM users WHERE phone = $1 FOR UPDATE",
        [receiver_phone]
      );

      if (receiverResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "Destinatário não encontrado",
        });
      }

      const receiver = receiverResult.rows[0];

      await client.query(
        `UPDATE users
         SET balance = balance - $1
         WHERE id = $2`,
        [value, req.user.id]
      );

      await client.query(
        `UPDATE users
         SET balance = balance + $1
         WHERE id = $2`,
        [value, receiver.id]
      );

      const transactionResult = await client.query(
        `INSERT INTO transactions
         (sender_id, receiver_id, amount, description)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          req.user.id,
          receiver.id,
          value,
          description || null,
        ]
      );

      await client.query("COMMIT");

      res.status(201).json({
        message: "Transferência efetuada com sucesso",
        transaction: transactionResult.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      res.status(500).json({
        error: "Erro ao efetuar transferência",
      });
    } finally {
      client.release();
    }
  }
);

app.get("/api/transactions", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         t.id,
         t.amount,
         t.description,
         t.type,
         t.status,
         t.created_at,
         s.name AS sender_name,
         s.phone AS sender_phone,
         r.name AS receiver_name,
         r.phone AS receiver_phone
       FROM transactions t
       JOIN users s ON s.id = t.sender_id
       JOIN users r ON r.id = t.receiver_id
       WHERE t.sender_id = $1
          OR t.receiver_id = $1
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    res.json({
      transactions: result.rows,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Erro ao consultar histórico",
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NeyWallet Backend running on port ${PORT}`);
});
