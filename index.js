require('dotenv').config();

const ethers = require('ethers');
const { BigNumber, utils } = ethers;

const provider = new ethers.providers.WebSocketProvider(
  `wss://mainnet.infura.io/ws/v3/${process.env.INFURA_ID}`,
  'mainnet',
);

const depositWallet = new ethers.Wallet(
  process.env.DEPOSIT_WALLET_PRIVATE_KEY,
  provider,
);

const main = async () => {
  const depositWalletAddress = await depositWallet.getAddress();
  console.log(`Watching for incoming tx to ${depositWalletAddress}…`);

  const handleWithdrawal = async () => {
    const currentBalance = await depositWallet.getBalance('latest');
    const gasPrice = await provider.getGasPrice();

    // Adjust the gas limit based on your transaction requirements
    const gasLimit = 21000;
    const maxGasFee = BigNumber.from(gasLimit).mul(gasPrice);

    const withdrawalTx = {
      to: process.env.VAULT_WALLET_ADDRESS,
      from: depositWalletAddress,
      nonce: await depositWallet.getTransactionCount(),
      value: currentBalance.sub(maxGasFee),
      chainId: 1, //// mainnet: 1
      gasPrice: gasPrice,
      gasLimit: gasLimit,
    };

    return depositWallet.sendTransaction(withdrawalTx);
  };

  const retryWithBackoff = async (attempt) => {
    try {
      await handleWithdrawal();
    } catch (error) {
      console.error(`Withdrawal attempt ${attempt} failed:`, error);
      const maxAttempts = 5;
      const maxDelay = 5000;
      const delay = Math.min(2 ** attempt * 1000, maxDelay);

      if (attempt < maxAttempts) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        setTimeout(async () => await retryWithBackoff(attempt + 1), delay);
      } else {
        console.error('Max retry attempts reached. Exiting...');
      }
    }
  };

  provider.on('pending', async (pendingTxHash) => {
    try {
      const pendingTx = await provider.getTransaction(pendingTxHash);

      if (pendingTx !== null && pendingTx.to === depositWalletAddress) {
        console.log(`Receiving ${utils.formatEther(pendingTx.value)} ETH from ${pendingTx.from}…`);
        console.log(`Waiting for ${process.env.CONFIRMATIONS_BEFORE_WITHDRAWAL} confirmations…`);

        await pendingTx.wait(process.env.CONFIRMATIONS_BEFORE_WITHDRAWAL);
        console.log('Transaction Withdrawn to Vault Wallet. ✅ ');

        await retryWithBackoff(1);
      }
    } catch (err) {
      console.error(err);
    }
  });
};

if (require.main === module) {
  main();
}
