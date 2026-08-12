const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

router.post("/transfer", authenticateToken, async (req, res) => {
  const client = await pool.connect();

  try {
    const { recipientPhone, amount, description } = req.body;
    const value = Number(amount);

    if (!recipientPhone || !Number.isFinite(value) || value <= 0) {
      return res.status(400).json({
        success: false,
        message: "Destinatário e valor válido são obrigatórios"
      });
    }

    if (recipientPhone === req.user.phone) {
      return res.status(400).json({
        success: false,
        message: "Não pode transferir dinheiro para si próprio"
      });
    }

    await client.query("BEGIN");

    const senderResult = await client.query(
      `SELECT id, balance
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [req.user.id]
    );

    if (senderResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Conta de origem não encontrada"
      });
    }

    const sender = senderResult.rows[0];

    if (Number(sender.balance) < value) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Saldo insuficiente"
      });
    }

    const recipientResult = await client.query(
      `SELECT id, name, phone
       FROM users
       WHERE phone = $1
       FOR UPDATE`,
      [recipientPhone]
    );

    if (recipientResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Destinatário não encontrado"
      });
    }

    const recipient = recipientResult.rows[0];

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
      [value, recipient.id]
    );

    const transactionResult = await client.query(
      `INSERT INTO transactions
       (sender_id, receiver_id, amount, description, type, status)
       VALUES ($1, $2, $3, $4, 'TRANSFER', 'COMPLETED')
       RETURNING id, amount, description, type, status, created_at`,
      [
        req.user.id,
        recipient.id,
        value,
        description || null
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Transferência realizada com sucesso",
      transaction: transactionResult.rows[0],
      recipient: {
        id: recipient.id,
        name: recipient.name,
        phone: recipient.phone
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Erro ao realizar transferência"
    });
  } finally {
    client.release();
  }
});

router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        t.id,
        t.amount,
        t.description,
        t.type,
        t.status,
        t.created_at,
        sender.name AS sender_name,
        sender.phone AS sender_phone,
        receiver.name AS receiver_name,
        receiver.phone AS receiver_phone
       FROM transactions t
       JOIN users sender ON sender.id = t.sender_id
       JOIN users receiver ON receiver.id = t.receiver_id
       WHERE t.sender_id = $1 OR t.receiver_id = $1
       ORDER BY t.created_at DESC
       LIMIT 100`,
      [req.user.id]
    );

    res.json({
      success: true,
      transactions: result.rows
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Erro ao consultar histórico"
    });
  }
});

module.exports = router;
