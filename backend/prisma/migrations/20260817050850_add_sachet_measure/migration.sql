-- Add SACHET as a pack-size measure.
--
-- Some products ship as single-serve packets in a box ("30 sachets"). Kept as its
-- own measure rather than folded into COUNT so sachets never sort or group
-- alongside tablets — they are different things to count.
ALTER TYPE "PackSizeMeasure" ADD VALUE 'SACHET';
