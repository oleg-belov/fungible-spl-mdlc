import { initializeKeypair } from "./initializeKeypair"
import * as web3 from "@solana/web3.js"
import * as token from "@solana/spl-token"
import {
  Metaplex,
  keypairIdentity,
  bundlrStorage,
  toMetaplexFile,
} from "@metaplex-foundation/js"
import { DataV2, createCreateMetadataAccountV2Instruction, createCreateMetadataAccountV3Instruction, createUpdateMetadataAccountInstruction } from '@metaplex-foundation/mpl-token-metadata';

import * as fs from "fs"
import { createInitializeMintInstruction } from "@solana/spl-token";

const tokenName = "Moldova coin"
const description = "Description"
const symbol = "MDLC"
const decimals = 2
const amount = 100

async function main() {
  const connection = new web3.Connection(web3.clusterApiUrl("devnet"))
  const user = await initializeKeypair(connection)

  console.log("PublicKey:", user.publicKey.toBase58())

  // rent for token mint
  const lamports = await token.getMinimumBalanceForRentExemptMint(connection)

  // keypair for new token mint
  const mintKeypair = web3.Keypair.generate()

  // metaplex setup
  const metaplex = Metaplex.make(connection)
    .use(keypairIdentity(user))
    .use(
      bundlrStorage({
        address: "https://devnet.bundlr.network",
        providerUrl: "https://api.devnet.solana.com",
        timeout: 60000,
      })
    )

  // get metadata PDA for token mint
  const metadataPDA = metaplex.nfts().pdas().metadata({
    mint: mintKeypair.publicKey
})

  // get associated token account address for use
  const tokenATA = await token.getAssociatedTokenAddress(
    mintKeypair.publicKey,
    user.publicKey
  )

  // file to buffer
  const buffer = fs.readFileSync("assets/mdlc.png")

  // buffer to metaplex file
  const file = toMetaplexFile(buffer, "mdlc.png")

  // upload image and get image uri
  const imageUri = await metaplex.storage().upload(file)
  console.log("image uri:", imageUri)

  // upload metadata and get metadata uri (off chain metadata)
  const { uri } = await metaplex
    .nfts()
    .uploadMetadata({
      name: tokenName,
      description: description,
      image: imageUri,
    })

  console.log("metadata uri:", uri)

  // onchain metadata format
  const tokenMetadata = {
    name: tokenName,
    symbol: symbol,
    uri: uri,
    sellerFeeBasisPoints: 0,
    creators: null,
    collection: null,
    uses: null,
  } as DataV2

  // transaction to create metadata account
  const transaction = new web3.Transaction().add(
    // create new account
    web3.SystemProgram.createAccount({
      fromPubkey: user.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: token.MINT_SIZE,
      lamports: lamports,
      programId: token.TOKEN_PROGRAM_ID,
    }),
    // create new token mint
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      decimals,
      user.publicKey,
      user.publicKey,
      token.TOKEN_PROGRAM_ID
    ),
    // create metadata account
    createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataPDA,
        mint: mintKeypair.publicKey,
        mintAuthority: user.publicKey,
        payer: user.publicKey,
        updateAuthority: user.publicKey,
      },
      {
        createMetadataAccountArgsV3: {
          data: tokenMetadata,
          isMutable: true,
          collectionDetails: null
        },
      }
    )
  )

  // instruction to create ATA
  const createTokenAccountInstruction = token.createAssociatedTokenAccountInstruction(
    user.publicKey, // payer
    tokenATA, // token address
    user.publicKey, // token owner
    mintKeypair.publicKey // token mint
  )

  let tokenAccount: token.Account
  try {
    // check if token account already exists
    tokenAccount = await token.getAccount(
      connection, // connection
      tokenATA // token address
    )
  } catch (error: unknown) {
    if (
      error instanceof token.TokenAccountNotFoundError ||
      error instanceof token.TokenInvalidAccountOwnerError
    ) {
      try {
        // add instruction to create token account if one does not exist
        transaction.add(createTokenAccountInstruction)
      } catch (error: unknown) {}
    } else {
      throw error
    }
  }

  transaction.add(
    // mint tokens to token account
    token.createMintToInstruction(
      mintKeypair.publicKey,
      tokenATA,
      user.publicKey,
      amount * Math.pow(10, decimals)
    )
  )

  // send transaction
  const transactionSignature = await web3.sendAndConfirmTransaction(
    connection,
    transaction,
    [user, mintKeypair]
  )

  console.log(
    `Transaction: https://explorer.solana.com/tx/${transactionSignature}?cluster=devnet`
  )
}

main()
  .then(() => {
    console.log("Finished successfully")
    process.exit(0)
  })
  .catch((error) => {
    console.log(error)
    process.exit(1)
  })

