import {
  AccountMeta,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js"

import {
  Program,
  AnchorProvider,
  Idl,
  setProvider,
  BN,
} from "@coral-xyz/anchor"
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet"
import {
  ConcurrentMerkleTreeAccount,
  MerkleTree,
  MerkleTreeProof,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from "@solana/spl-account-compression"
import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID } from "@metaplex-foundation/mpl-bubblegum"
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata"
import { WrapperConnection } from "./ReadApi/WrapperConnection"
import { explorerURL, loadKeypairFromFile } from "./utils/helpers"
import { IDL, CnftTransfer } from "../target/types/cnft_transfer"
import dotenv from "dotenv"
dotenv.config()
;(async () => {
  const connection = new WrapperConnection(process.env.RPC_URL, "confirmed")
  const payer = loadKeypairFromFile(process.env.LOCAL_PAYER_JSON_ABSPATH)
  const balance = await connection.getBalance(payer.publicKey)
  console.log("balance", balance / LAMPORTS_PER_SOL)

  const provider = new AnchorProvider(connection, new NodeWallet(payer), {})
  setProvider(provider)
  const programId = new PublicKey(
    "ApT1qWmvuGbpjTyDXhB3U2yjxvb612xDRoeYqsUjUVgo"
  )
  const program = new Program(
    IDL as Idl,
    programId
  ) as unknown as Program<CnftTransfer>

  const treeAuthority = new PublicKey(
    "6u8dggPgY2jSP5jzhPXyUc8HrMpM7DTWfUgRK33zKEek"
  )

  const assetId = new PublicKey(
    await connection
      .getAssetsByOwner({
        ownerAddress: payer.publicKey.toBase58(),
      })
      .then((res) => {
        console.log("Total assets returned:", res.total)

        for (const asset of res.items || []) {
          // only show compressed nft assets
          if (!asset.compression.compressed) continue

          // only show assets with the target treeAuthority
          const hasTargetAddress = asset.authorities.some(
            (authority) => authority.address === treeAuthority.toString()
          )

          if (!hasTargetAddress) continue

          // return first matching asset
          return asset.id
        }

        console.log("No matching asset found")
        return null
      })
  )

  console.log("Asset ID:", assetId.toBase58())
  const asset = await connection.getAsset(assetId)
  const assetProof = await connection.getAssetProof(assetId)
  const treeAddress = new PublicKey(asset.compression.tree)
  const treeAccount = await ConcurrentMerkleTreeAccount.fromAccountAddress(
    connection,
    treeAddress
  )
  // const treeAuthority = treeAccount.getAuthority()
  const canopyDepth = treeAccount.getCanopyDepth()

  const proofPath: AccountMeta[] = assetProof.proof
    .map((node: string) => ({
      pubkey: new PublicKey(node),
      isSigner: false,
      isWritable: false,
    }))
    .slice(0, assetProof.proof.length - (!!canopyDepth ? canopyDepth : 0))

  const root = [...new PublicKey(assetProof.root.trim()).toBytes()]
  const dataHash = [
    ...new PublicKey(asset.compression.data_hash.trim()).toBytes(),
  ]
  const creatorHash = [
    ...new PublicKey(asset.compression.creator_hash.trim()).toBytes(),
  ]
  const nonce = asset.compression.leaf_id
  const index = asset.compression.leaf_id

  const tx = await program.methods
    .transferCompressedNft(root, dataHash, creatorHash, new BN(nonce), index)
    .accounts({
      leafOwner: payer.publicKey,
      leafDelegate: payer.publicKey,
      newLeafOwner: payer.publicKey, // test transfer to self
      merkleTree: treeAddress,
      treeAuthority: treeAuthority,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    })
    .remainingAccounts(proofPath)
    .transaction()

  const txSignature = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  })
  console.log(explorerURL({ txSignature }))

  const tx2 = await program.methods
    .burnCompressedNft(root, dataHash, creatorHash, new BN(nonce), index)
    .accounts({
      leafOwner: payer.publicKey,
      leafDelegate: payer.publicKey,
      merkleTree: treeAddress,
      treeAuthority: treeAuthority,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    })
    .remainingAccounts(proofPath)
    .transaction()

  const txSignature2 = await sendAndConfirmTransaction(
    connection,
    tx2,
    [payer],
    {
      commitment: "confirmed",
    }
  )
  console.log(explorerURL({ txSignature: txSignature2 }))
})()
