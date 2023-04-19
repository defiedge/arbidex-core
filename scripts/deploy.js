const { ethers } = require('hardhat')

async function main() {

    const ARBIDEX_ADDRESS_TO_RECEIVE_FEES = ""
    const DEFIEDGE_ADDRESS_TO_RECEIVE_FEES = ""

    const NEW_OWNER = ""

    let UniswapV3PoolDeployer = await ethers.getContractFactory("UniswapV3PoolDeployer");
    const poolDeployer = await UniswapV3PoolDeployer.deploy()
    console.log(`🎉 UniswapV3PoolDeployer Deployed to: ${poolDeployer.address}`)

    let ProtocolFeeSplitter = await ethers.getContractFactory('ProtocolFeeSplitter')
    const protocolFeeSplitter = await ProtocolFeeSplitter.deploy(ARBIDEX_ADDRESS_TO_RECEIVE_FEES, DEFIEDGE_ADDRESS_TO_RECEIVE_FEES)
    console.log(`🎉 ProtocolFeeSplitter Deployed to: ${protocolFeeSplitter.address}`)

    let UniswapV3Factory = await ethers.getContractFactory('UniswapV3Factory')
    const uniswapFactory = await UniswapV3Factory.deploy(poolDeployer.address, protocolFeeSplitter.address)
    console.log(`🎉 UniswapV3Factory Deployed to: ${uniswapFactory.address}`)

    await protocolFeeSplitter.setFactoryAddress(uniswapFactory.address)
    await poolDeployer.setFactoryAddress(uniswapFactory.address)

    // if want to change owner of UniswapV3Factory contract
    if(NEW_OWNER != ""){
        await uniswapFactory.setOwner(NEW_OWNER)
    }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })