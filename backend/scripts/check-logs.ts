import { prisma } from "../src/lib/prisma.js";

async function main() {
  const logs = await prisma.whatsAppLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log("Found", logs.length, "logs:");
  for (const log of logs) {
    console.log("=========================================");
    console.log("ID:", log.id);
    console.log("Order ID:", log.orderId);
    console.log("Phone:", log.toPhone);
    console.log("Template:", log.templateName);
    console.log("Status:", log.status);
    console.log("Provider Msg ID:", log.providerMessageId);
    console.log("Error Code:", log.errorCode);
    console.log("Error Detail:", log.errorDetail);
    console.log("Payload:", JSON.stringify(log.payload, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
