import { Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { UniswapV3Factory } from '../typechain/UniswapV3Factory'
import { UniswapV3PoolDeployer } from '../typechain/UniswapV3PoolDeployer'
import { ProtocolFeeSplitter } from '../typechain/ProtocolFeeSplitter'
import { expect } from './shared/expect'
import snapshotGasCost from './shared/snapshotGasCost'

import { FeeAmount, getCreate2Address, TICK_SPACINGS } from './shared/utilities'

const { constants } = ethers

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000',
]

const createFixtureLoader = waffle.createFixtureLoader
describe('UniswapV3PoolDeployer', () => {
  let wallet: Wallet, other: Wallet, other2: Wallet

  let factory: UniswapV3Factory
  let poolDeployer: UniswapV3PoolDeployer
  let arbidexFeeSplitter: ProtocolFeeSplitter
  let poolBytecode: string

  const fixture = async () => {
    let ProtocolFeeSplitter = await ethers.getContractFactory('ProtocolFeeSplitter');
    arbidexFeeSplitter = await ProtocolFeeSplitter.deploy(other.address, other2.address) as ProtocolFeeSplitter;

    let UniswapV3PoolDeployer = await ethers.getContractFactory('UniswapV3PoolDeployer');
    poolDeployer = await UniswapV3PoolDeployer.deploy() as UniswapV3PoolDeployer;

    const factoryFactory = await ethers.getContractFactory('UniswapV3Factory')
    return (await factoryFactory.deploy(poolDeployer.address, arbidexFeeSplitter.address)) as UniswapV3Factory
  }

  let loadFixture: ReturnType<typeof createFixtureLoader>
  before('create fixture loader', async () => {
    ;[wallet, other, other2] = await (ethers as any).getSigners()

    loadFixture = createFixtureLoader([wallet, other])
  })

  before('load pool bytecode', async () => {
    poolBytecode = (await ethers.getContractFactory('UniswapV3Pool')).bytecode
  })

  beforeEach('deploy factory', async () => {
    factory = await loadFixture(fixture)

    await arbidexFeeSplitter.setFactoryAddress(factory.address)
  })

  describe('#createPool', () => {
    it('succeeds revert if not called by factory', async () => {
      await poolDeployer.setFactoryAddress(factory.address)

      await expect(poolDeployer.deploy(
        factory.address,
        TEST_ADDRESSES[0],
        TEST_ADDRESSES[1],
        FeeAmount.MEDIUM,
        60
      )).to.be.revertedWith("only factory can call deploy")
    })
  })

  describe('#setFactoryAddress', () => {
    it('fails if already initailized', async () => {
      await poolDeployer.setFactoryAddress(other.address);
      await expect(poolDeployer.setFactoryAddress(wallet.address)).to.be.revertedWith("already initialized")
    })

    it('set factory contract address', async () => {
      expect(await poolDeployer.factoryAddress()).to.eq(ethers.constants.AddressZero)
      await poolDeployer.setFactoryAddress(factory.address)
      expect(await poolDeployer.factoryAddress()).to.eq(factory.address)
      await expect(poolDeployer.setFactoryAddress(wallet.address)).to.be.reverted
    })

    it('emits event', async () => {
      await expect(poolDeployer.setFactoryAddress(factory.address))
        .to.emit(poolDeployer, 'SetFactoryAddress')
        .withArgs(factory.address)
    })
  })

})