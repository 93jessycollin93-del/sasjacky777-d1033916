"""JackieConstellationGuide — sovereign guide persona++++++."""

# The six singletons below are built at the bottom of this module, and until
# now none of them were imported: the module referenced them as bare globals
# and so raised NameError the moment anything imported it. They are pulled from
# the `cluster_*` siblings that define them, package-relative, because that is
# how the rest of this package addresses itself.
from .cluster_constellation_identity import identity
from .cluster_constellation_temporal import temporal_fabric
from .cluster_constellation_topology import topology
from .cluster_global_coherence import coherence_pp
from .cluster_meta_governance import meta_governance
from .cluster_sovereign_safety import safety_envelope


class JackieConstellationGuide:
    """Jackie's constellation-level guide; communicates at altitude."""

    def __init__(self, identity, topology, safety, governance, coherence, temporal):
        self.identity = identity
        self.topology = topology
        self.safety = safety
        self.governance = governance
        self.coherence = coherence
        self.temporal = temporal

    def constellation_perspective(self):
        return {
            "identity": self.identity.constellation,
            "topology": self.topology.topology,
            "safety": "sovereign-envelope",
            "coherence": "global",
            "temporal": "stable"
        }


guide = JackieConstellationGuide(
    identity, topology, safety_envelope, meta_governance, coherence_pp, temporal_fabric
)