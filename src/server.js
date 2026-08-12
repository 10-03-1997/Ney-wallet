require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const walletRoutes = require("./routes/wallet");
const transactionRoutes = require("./routes/transactions");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "NeyWallet API está funcionando",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/transactions", transactionRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Rota não encontrada"
  });
});

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    message: "Erro interno do servidor"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`NeyWallet API rodando na porta ${PORT}`);
});
