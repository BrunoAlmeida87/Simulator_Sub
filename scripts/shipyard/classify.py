# classifica água / vegetação / construído (média de duas cenas): grava s2/img/cls.npy
import sys
import numpy as np
a, b = sys.argv[1], sys.argv[2]  # datas, ex.: 20260721 20260701
n = (np.load(f's2/img/{a}_B08.npy') + np.load(f's2/img/{b}_B08.npy')) / 2
r = (np.load(f's2/img/{a}_B04.npy') + np.load(f's2/img/{b}_B04.npy')) / 2
ndvi = (n - r) / (n + r + 1e-6)
water = n < 600
veg = (~water) & (ndvi > 0.45)
built = (~water) & (~veg)
np.save('s2/img/cls.npy', np.stack([water, veg, built]).astype(np.uint8))
print('água', int(water.sum()), 'vegetação', int(veg.sum()), 'construído', int(built.sum()))
