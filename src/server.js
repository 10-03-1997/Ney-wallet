require("dotenv").config();

const express = require("express");
const cors = require("cors");

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`NeyWallet API rodando na porta ${PORT}`);
});
