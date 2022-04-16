const REWARD_TOKEN = {
    1:'0x111111517e4929D3dcbdfa7CCe55d30d4B6BC4d6', //mainnet
    42: '' //kovan
}

module.exports = async function ({ ethers: { getNamedSigner }, getNamedAccounts, deployments }) {
    const { deploy } = deployments
  
    const { deployer, dev } = await getNamedAccounts()
  
    const chainId = await getChainId()
    
    let rwTokenAddress;
    
    if (chainId === '31337') {
      rwTokenAddress = (await deployments.get("Ichi")).address
    } else if (chainId in REWARD_TOKEN) {
      rwTokenAddress = REWARD_TOKEN[chainId]
    } else {
      throw Error("No REWARD_TOKEN Token!")
    }
  
    await deploy("stakeAndLockFarm", {
      from: deployer,
      args: [rwTokenAddress,1],
      log: true,
      deterministicDeployment: false
    })
  
  }
  
  module.exports.tags = ["stakeAndLockFarm"]
