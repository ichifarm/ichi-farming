const REWARD_TOKEN = {
    1:'0x903bEF1736CDdf2A537176cf3C64579C3867A881', //mainnet
    42: '0xdF2661E2E6A35B482E3F105bDE628B5e1F68aB41' //kovan
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
  
    await deploy("genericFarmV2", {
      from: deployer,
      args: [rwTokenAddress,1],
      log: true,
      deterministicDeployment: false
    })
  
  }
  
  module.exports.tags = ["genericFarmV2"]
