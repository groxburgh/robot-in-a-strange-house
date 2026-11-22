"""Build src/data.js from two public datasets.

  Housekeep (Kant et al., ECCV 2022; MIT licence; github.com/yashkant/housekeep)
    Human annotations: for an object shown in a room, 10 people marked each
    receptacle in that room as where it's found when MISPLACED (before
    tidying), where it's CORRECT (after tidying), or implausible.
    -> ground truth for where the household leaves things, and what "tidy" means.

  ProcTHOR (Deitke et al., NeurIPS 2022; Apache 2.0; github.com/allenai/procthor)
    placement-annotations.json: a 0-2 score per object type for kitchens,
    living rooms, bedrooms and bathrooms, used by ProcTHOR to furnish houses.
    -> an independent "common sense" prior for the robot's room hints.

Usage:
  python3 tools/hk_extract.py <housekeep>/cos_eor/scripts/orm/amt_data/data.npy hk_counts.json
  python3 tools/build_priors.py hk_counts.json <procthor>/procthor/databases/placement-annotations.json src/data.js
"""
import json, sys
from collections import defaultdict

hk_path, pt_path, out_path = sys.argv[1:4]
hk = json.load(open(hk_path))
pt = json.load(open(pt_path))

# Housekeep room -> our room type.
ROOMS = {
    'living_room': 'living room', 'television_room': 'living room',
    'kitchen': 'kitchen', 'pantry_room': 'kitchen',
    'bedroom': 'bedroom', 'bathroom': 'bathroom',
    'home_office': 'office', 'dining_room': 'dining room', 'utility_room': 'laundry room',
}

# Our furniture per room, each merging one or more Housekeep receptacle types.
# 'floor' collects Housekeep's carpets.
FURNITURE = {
    'living room': {'sofa': ['sofa', 'sofa_chair', 'chair', 'stool', 'office_chair'],
                    'bookshelf': ['shelf'],
                    'coffee table': ['coffee_table', 'table', 'console_table'],
                    'sideboard': ['bottom_cabinet', 'chest']},
    'kitchen': {'sink': ['sink', 'dishwasher'], 'fridge': ['fridge'],
                'counter': ['counter', 'table', 'cooktop', 'stove', 'oven', 'microwave', 'coffee_machine', 'chair'],
                'cupboard': ['top_cabinet', 'bottom_cabinet', 'shelf', 'chest']},
    'bedroom': {'bed': ['bed'], 'wardrobe': ['chest', 'bottom_cabinet'],
                'nightstand': ['table', 'console_table', 'counter', 'coffee_table'], 'bedroom shelf': ['shelf']},
    'bathroom': {'bathtub': ['bathtub'], 'basin': ['sink', 'counter'],
                 'bathroom cabinet': ['top_cabinet', 'bottom_cabinet', 'shelf'], 'toilet': ['toilet']},
    'office': {'desk': ['table', 'counter'], 'office chair': ['office_chair'],
               'office shelf': ['shelf', 'top_cabinet', 'bottom_cabinet']},
    'dining room': {'dining table': ['table', 'counter'], 'dining chair': ['chair', 'sofa'],
                    'buffet': ['bottom_cabinet', 'console_table']},
    'laundry room': {'washing machine': ['washer', 'dryer'], 'utility sink': ['sink'],
                     'laundry shelf': ['top_cabinet', 'bottom_cabinet', 'table']},
}

# Our object name -> (Housekeep category, ProcTHOR object type, small?)
OBJECTS = {
    'mug': ('mug', 'Mug', False), 'cup': ('cup', 'Cup', False), 'plate': ('plate', 'Plate', False),
    'bowl': ('bowl', 'Bowl', False), 'apple': ('apple', 'Apple', False), 'book': ('book', 'Book', False),
    'towel': ('towel', 'Towel', False), 'pillow': ('pillow', 'Pillow', False), 'laptop': ('laptop', 'Laptop', False),
    'remote': ('remote_control', 'RemoteControl', True), 'vase': ('vase', 'Vase', False), 'pan': ('pan', 'Pan', False),
    'spoon': ('spoon', 'Spoon', True), 'fork': ('fork', 'Fork', True), 'knife': ('knife', 'Knife', True),
    'sponge': ('sponge', 'DishSponge', True), 'cloth': ('cloth', 'Cloth', True), 'shoes': ('shoe', 'Boots', False),
    'teddy bear': ('stuffed_toy', 'TeddyBear', False), 'water bottle': ('water_bottle', 'Bottle', False),
    'box': ('box', 'Box', False),
}
PT_ROOMS = {'inKitchens': 'kitchen', 'inLivingRooms': 'living room', 'inBedrooms': 'bedroom', 'inBathrooms': 'bathroom'}

objects = {}
for name, (hk_name, pt_name, small) in OBJECTS.items():
    counts = hk['counts'][hk_name]
    misplaced = defaultdict(lambda: defaultdict(int))  # room -> furniture -> summed votes
    correct = defaultdict(int)                          # furniture -> best single receptacle's votes
    for rr, (before, after, n) in counts.items():
        hk_room, recep = rr.split('|')
        room = ROOMS.get(hk_room)
        if not room:
            continue
        targets = ['floor'] if recep == 'carpet' else [f for f, src in FURNITURE[room].items() if recep in src]
        for f in targets:
            misplaced[room][f] += before
            if f != 'floor':
                correct[f] = max(correct[f], after)
    procthor = {room: pt[key].get(pt_name, 0) for key, room in PT_ROOMS.items()}
    objects[name] = {
        'housekeep': hk_name, 'procthor': pt_name, 'small': small,
        'misplaced': {r: dict(v) for r, v in misplaced.items()},
        'correct': dict(correct),
        'procthorRooms': procthor,
    }

data = {
    'sources': {
        'housekeep': 'Kant et al., "Housekeep: Tidying Virtual Households using Commonsense Reasoning", ECCV 2022. MIT licence. https://github.com/yashkant/housekeep',
        'procthor': 'Deitke et al., "ProcTHOR: Large-Scale Embodied AI Using Procedural Generation", NeurIPS 2022. Apache 2.0. https://github.com/allenai/procthor',
    },
    'furniture': {room: list(fs) for room, fs in FURNITURE.items()},
    'objects': objects,
}
with open(out_path, 'w') as f:
    f.write('// GENERATED by tools/build_priors.py from public datasets. Do not edit by hand.\n')
    f.write('// Housekeep (MIT) human annotations and ProcTHOR (Apache 2.0) placement annotations.\n')
    f.write('export default ')
    json.dump(data, f, separators=(',', ':'))
    f.write(';\n')
print('wrote', out_path, len(objects), 'objects')
