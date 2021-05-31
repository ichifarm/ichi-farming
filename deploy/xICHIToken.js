const ICHI = {
  1:'0x903bEF1736CDdf2A537176cf3C64579C3867A881', //mainnet
  42: '0x883Cc74d965edB77311A3f9a93649e92E2aa14ba' //kovan
}

module.exports = async function ({ getNamedAccounts, deployments }) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()
  const chainId = await getChainId()


  let ichiAddress
  if (chainId === '31337') {
    ichiAddress = (await deployments.get("Ichi")).address
  } else if (chainId in ICHI) {
    ichiAddress = ICHI[chainId]
  } else {
    throw Error("No ICHI Token!")
  }

  if (chainId != 1) {
    await deploy("IchiStake", {
      from: deployer,
      args: [ichiAddress],
      log: true,
      deterministicDeployment: false
    })
  }
    

  
}

module.exports.tags = ["xICHI"]
module.exports.dependencies = ["ICHI"]
