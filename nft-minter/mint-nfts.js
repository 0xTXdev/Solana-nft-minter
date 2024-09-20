import "dotenv/config";
import fs from "fs";
import path from "path";
import {
  Metaplex,
  keypairIdentity,
  irysStorage,
  toMetaplexFile,
  sol,
} from "@metaplex-foundation/js";
import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCandyMachine } from "@metaplex-foundation/mpl-candy-machine";

import {
  TokenStandard,
  createNft,
} from "@metaplex-foundation/mpl-token-metadata";
import { create } from "@metaplex-foundation/mpl-candy-machine";
import { generateSigner, percentAmount } from "@metaplex-foundation/umi";
import { some } from "@metaplex-foundation/umi";

const TOTAL_NFTS = 3;
const METADATA_DIR = path.join(process.cwd(), "build/json");
const IMAGES_DIR = path.join(process.cwd(), "build/images");

async function main() {
  // Connect to Solana
  const connection = new Connection(process.env.RPC_URL);

  // Set up your wallet
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(process.env.PRIVATE_KEY))
  );

  // Set up Metaplex
  const metaplex = Metaplex.make(connection)
    .use(keypairIdentity(wallet))
    .use(
      irysStorage({
        address: "https://devnet.bundlr.network",
        providerUrl: "https://api.devnet.solana.com",
        timeout: 60000,
      })
    );

  const umi = createUmi(process.env.RPC_URL)
    .use(mplCandyMachine())
    .use(keypairIdentity(wallet));

  // Prepare and upload images, update metadata
  console.log("Preparing and uploading images, updating metadata...");
  const nfts = [];
  for (let i = 1; i <= TOTAL_NFTS; i++) {
    const imagePath = path.join(IMAGES_DIR, `${i}.png`);
    const metadataPath = path.join(METADATA_DIR, `${i}.json`);

    // Upload image
    const imageBuffer = await fs.readFileSync(imagePath);

    const file = toMetaplexFile(imageBuffer, imagePath);
    const imageUri = await metaplex.storage().upload(file);

    // Read and update metadata
    let metadata = JSON.parse(await fs.readFileSync(metadataPath, "utf8"));

    metadata.image = imageUri;

    // Upload metadata
    const metadataFile = toMetaplexFile(
      Buffer.from(JSON.stringify(metadata)),
      `${i}.json`
    );
    const uploadResult = await metaplex.storage().upload(metadataFile);

    nfts.push({ name: metadata.name, uri: uploadResult, index: i - 1 });
    console.log(`Prepared NFT ${i}/${TOTAL_NFTS}`);
    console.log(`NFT ${i}:`, nfts[i - 1]);
  }

  const collectionMetadata = {
    name: "Phoenix NFT",
    description: "500 NFTs collection",
    image: "https://arweave.net/E28XGBMBQwGVc-XMKVTCGv4cjy36K4vbOy5oLhQclBw",
    isCollection: true,
  };

  const collectionMetadataFile = toMetaplexFile(
    Buffer.from(JSON.stringify(collectionMetadata)),
    "collection-metadata.json"
  );

  const NFT_METADATA = await metaplex.storage().upload(collectionMetadataFile);

  //   const { nft: collectionNft } = await metaplex.nfts().create({
  //     name: "Phoenix500",
  //     uri: NFT_METADATA,
  //     sellerFeeBasisPoints: 0,
  //     isCollection: true,
  //     updateAuthority: wallet,
  //   });
  //   // Create Candy Machine
  //   console.log("Creating Candy Machine...");

  //   const { candyMachine } = await metaplex.candyMachines().create({
  //     itemsAvailable: TOTAL_NFTS,
  //     sellerFeeBasisPoints: 500, // 5% royalty
  //     collection: {
  //       address: collectionNft.address,
  //       updateAuthority: wallet,
  //     },
  //     items: nfts,
  //   });

  // Create the Collection NFT.

  const collectionMint = generateSigner(umi);
  await createNft(umi, {
    mint: collectionMint,
    authority: umi.identity,
    name: "Phoenix NFT",
    uri: NFT_METADATA,
    sellerFeeBasisPoints: percentAmount(9.99, 2), // 9.99%
    isCollection: true,
  }).sendAndConfirm(umi);

  // Create the Candy Machine.
  const candyMachine = generateSigner(umi);
  await create(umi, {
    candyMachine,
    collectionMint: collectionMint.publicKey,
    collectionUpdateAuthority: umi.identity,
    tokenStandard: TokenStandard.NonFungible,
    sellerFeeBasisPoints: percentAmount(9.99, 2), // 9.99%
    itemsAvailable: 5000,
    creators: [
      {
        address: umi.identity.publicKey,
        verified: true,
        percentageShare: 100,
      },
    ],
    configLineSettings: some({
      prefixName: "",
      nameLength: 32,
      prefixUri: "",
      uriLength: 200,
      isSequential: false,
    }),
  }).sendAndConfirm(umi);

  console.log(
    `Candy Machine created with address: ${candyMachine.address.toString()}`
  );

  // Mint NFTs
  for (let i = 0; i < TOTAL_NFTS; i++) {
    console.log(`Minting NFT ${i + 1}/${TOTAL_NFTS}`);

    const { nft } = await metaplex.candyMachines().mint(
      {
        candyMachine,
        collectionUpdateAuthority: wallet.publicKey,
      },
      { commitment: "finalized" }
    );

    console.log(`Minted NFT: ${nft.address.toString()}`);

    // Optional: Add a delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("Minting complete!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
