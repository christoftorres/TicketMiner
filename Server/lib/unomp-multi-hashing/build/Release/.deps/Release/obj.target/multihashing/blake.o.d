cmd_Release/obj.target/multihashing/blake.o := cc '-DNODE_GYP_MODULE_NAME=multihashing' '-D_DARWIN_USE_64_BIT_INODE=1' '-D_LARGEFILE_SOURCE' '-D_FILE_OFFSET_BITS=64' '-DBUILDING_NODE_EXTENSION' -I/Users/Christof/.node-gyp/4.4.5/include/node -I/Users/Christof/.node-gyp/4.4.5/src -I/Users/Christof/.node-gyp/4.4.5/deps/uv/include -I/Users/Christof/.node-gyp/4.4.5/deps/v8/include -I../crypto -I../node_modules/nan  -Os -gdwarf-2 -mmacosx-version-min=10.5 -arch x86_64 -Wall -Wendif-labels -W -Wno-unused-parameter -fno-strict-aliasing -MMD -MF ./Release/.deps/Release/obj.target/multihashing/blake.o.d.raw   -c -o Release/obj.target/multihashing/blake.o ../blake.c
Release/obj.target/multihashing/blake.o: ../blake.c ../blake.h \
  ../sha3/sph_blake.h ../sha3/sph_types.h
../blake.c:
../blake.h:
../sha3/sph_blake.h:
../sha3/sph_types.h:
